/** Real settings controls and xterm; native persistence alone is mocked. No SSH sessions. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const path = relative => fileURLToPath(new URL(relative, import.meta.url)).replaceAll('\\', '/');
const source = ts.createSourceFile('settingsSlice.ts', await readFile(new URL('../src/store/settingsSlice.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const updaters = {};
function visit(node) {
  if (ts.isPropertyAssignment(node) && ['updateKeyboardSettings', 'updateKeybindings'].includes(node.name.getText(source))) {
    assert.equal(updaters[node.name.getText(source)], undefined);
    updaters[node.name.getText(source)] = node.initializer.getText(source);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(Object.keys(updaters).length, 2);
const defaultsModule = `import { SHORTCUT_CATALOG } from ${JSON.stringify(path('../src/features/shortcuts/catalog.ts'))};
export const defaultSettings = { keybindings: Object.fromEntries(SHORTCUT_CATALOG.filter(row => row.settingsKey).map(row => [row.settingsKey, row.defaultKeys])) };`;
const storeModule = `
import { create } from 'zustand';
import { createPreferencesQueue } from ${JSON.stringify(path('../src/features/settings/application/acknowledgedPreferences.ts'))};
const keybindingWrites = createPreferencesQueue();
import { normalizeKeyboardSettings } from ${JSON.stringify(path('../src/features/shortcuts/policy.ts'))};
import { defaultSettings } from ${JSON.stringify(path('../src/store/settingsSlice.ts'))};
const persistSettings = async patch => {
  window.hybridTest.writes.push(patch);
  await new Promise((resolve, reject) => { window.hybridTest.save = { resolve, reject }; });
};
export const useAppStore = create((set, get) => ({
  pendingKeybindingWrites: 0,
  settings: { keybindings: defaultSettings.keybindings, keyboard: normalizeKeyboardSettings(undefined) },
  showToast: (kind, text) => window.hybridTest.toasts.push({ kind, text }),
  updateKeyboardSettings: ${updaters.updateKeyboardSettings},
  updateKeybindings: ${updaters.updateKeybindings},
}));
window.hybridTest = { store: useAppStore, writes: [], toasts: [], actions: [], bytes: [], terminalKeys: [],
  loadLegacyShortcuts: () => useAppStore.setState(state => ({ settings: { ...state.settings,
    keybindings: { ...state.settings.keybindings, toggleSettings: 'Mod+Alt+3', commandPalette: 'Mod+Shift+B' },
    keyboard: normalizeKeyboardSettings({ terminalFocusPolicy: 'shell', terminalShortcutExceptions: [] }),
  } })),
};
`;
const bundle = await build({
  stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
    import { Terminal } from '@xterm/xterm';
    import { ShortcutsTab } from ${JSON.stringify(path('../src/components/settings/tabs/ShortcutsTab.tsx'))};
    import ${JSON.stringify(path('../src/components/settings/KeyboardShortcutsModal.tsx'))};
    import { TerminalShortcutControl } from ${JSON.stringify(path('../src/components/settings/common/TerminalShortcutControl.tsx'))};
    import { ModalRoot } from ${JSON.stringify(path('../src/components/ui/ModalRoot.tsx'))};
    import { useModalStore } from ${JSON.stringify(path('../src/lib/modalRegistry.ts'))};
    import { useAppStore } from ${JSON.stringify(path('../src/store/useAppStore.ts'))};
    import { SHORTCUT_CATALOG } from ${JSON.stringify(path('../src/features/shortcuts/catalog.ts'))};
    import { routeShortcut } from ${JSON.stringify(path('../src/features/shortcuts/route.ts'))};
    import { keyboardEventFocus, ownsLocalKeyboard } from ${JSON.stringify(path('../src/features/shortcuts/focus.ts'))};
    import { routeTerminalKey } from ${JSON.stringify(path('../src/lib/terminal/terminalKeyRouting.ts'))};
    function Fixture() {
      const settings = useAppStore(state => state.settings);
      return <TooltipProvider><TerminalShortcutControl menu onManage={() => useModalStore.getState().open('keyboardShortcuts')} />
        <ShortcutsTab settings={settings} updateKeybindings={useAppStore.getState().updateKeybindings} /><ModalRoot /></TooltipProvider>;
    }
    const term = window.hybridTest.term = new Terminal();
    term.open(document.getElementById('terminal'));
    term.attachCustomKeyEventHandler(event => {
      const allowed = routeTerminalKey(event, bytes => window.hybridTest.bytes.push(bytes));
      if (event.type === 'keydown') window.hybridTest.terminalKeys.push({ key: event.key, allowed });
      return allowed;
    });
    term.onData(bytes => window.hybridTest.bytes.push(bytes));
    window.addEventListener('keydown', event => {
      if (ownsLocalKeyboard(event)) return;
      const { settings } = useAppStore.getState();
      if (routeShortcut(event, keyboardEventFocus(event), settings.keyboard.terminalFocusPolicy,
        SHORTCUT_CATALOG, settings.keybindings, id => { window.hybridTest.actions.push(id); return true; }, settings.keyboard.terminalShortcutExceptions)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, { capture: true });
    createRoot(document.getElementById('root')).render(<Fixture />);
  `, resolveDir: path('../'), loader: 'tsx' },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'import.meta.env.DEV': 'false' },
  plugins: [{ name: 'isolated-settings-boundary', setup(builder) {
    builder.onResolve({ filter: /store\/useAppStore(\.ts)?$/ }, () => ({ path: 'settings-store', namespace: 'test-store' }));
    builder.onResolve({ filter: /store\/settingsSlice(\.ts)?$/ }, () => ({ path: 'defaults', namespace: 'test-defaults' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-store' }, () => ({ contents: storeModule, loader: 'ts', resolveDir: path('../') }));
    builder.onLoad({ filter: /.*/, namespace: 'test-defaults' }, () => ({ contents: defaultsModule, loader: 'ts', resolveDir: path('../') }));
  } }],
});
const assets = await readdir(new URL('../dist/assets/', import.meta.url));
const css = await readFile(new URL('../dist/assets/' + assets.find(name => /^index-.*\.css$/.test(name)), import.meta.url), 'utf8');
const xtermCss = await readFile(new URL('../node_modules/@xterm/xterm/css/xterm.css', import.meta.url), 'utf8');
const fixtureColors = await readFile(new URL('./uiOverlays.browser.css', import.meta.url), 'utf8');
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><link rel="stylesheet" href="/styles.css"><style>html,body{height:auto;overflow:auto!important}body{padding:16px;background-color:var(--color-app-bg)!important;color:var(--color-app-text)}#root{max-width:760px;margin:auto}#terminal{height:100px;max-width:640px}</style><body data-overlay-gallery-theme="dark" data-theme="dark"><div id="root"></div><div id="terminal"></div><input id="outside-field"><script type="module" src="/test.js"></script></body>');
  } else if (req.url === '/test.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text); }
  else if (req.url === '/styles.css') { res.setHeader('Content-Type', 'text/css'); res.end(css + xtermCss + fixtureColors); }
  else { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1000, height: 850 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  // The desktop paints its own window surface; this standalone page has no host.
  await page.evaluate(() => document.body.style.setProperty('background-color', 'var(--color-app-bg)', 'important'));
  const row = label => page.locator('[data-shortcut-label]').filter({ has: page.getByText(label, { exact: true }) });
  const search = page.getByRole('textbox', { name: 'Find a shortcut' });
  await search.waitFor();
  // Legacy settings acquire the secondary keys without selecting a preset.
  await page.evaluate(() => hybridTest.term.focus());
  const secondaryKeys = [
    ['b', 'toggleSidebarAlternative'], ['Space', 'commandPaletteAlternative'], ['i', 'aiCommandBarAlternative'],
    ['h', 'navigationWorkspaceAlternative'], ['u', 'navigationPublicUrlsAlternative'],
    ['g', 'navigationTunnelsAlternative'], ['j', 'navigationSnippetsAlternative'],
    ['o', 'navigationVaultsAlternative'], ['e', 'navigationPluginsAlternative'],
  ];
  for (const [key] of secondaryKeys) await page.keyboard.press('Control+Shift+' + key);
  assert.deepEqual(await page.evaluate(() => hybridTest.actions), secondaryKeys.map(([, id]) => id));
  assert.deepEqual(await page.evaluate(() => hybridTest.bytes), [], 'secondary keys are delivered once to Zync, never to the PTY');
  assert.equal(await page.evaluate(() => hybridTest.writes.length), 0, 'no preset click or settings write is needed');
  await page.keyboard.press('Control+p');
  assert.deepEqual(await page.evaluate(() => hybridTest.bytes), ['\x10'], 'the primary Ctrl+P remains shell history');
  await page.evaluate(() => { hybridTest.actions.length = 0; hybridTest.bytes.length = 0; });
  assert.equal(await row('Show Hosts').getByRole('switch').getAttribute('aria-checked'), 'false');
  await page.getByRole('button', { name: 'Use recommended reservations', exact: true }).click();
  assert.equal(await row('Show Hosts').getByRole('switch').getAttribute('aria-checked'), 'true');
  assert.equal(await row('Show Hosts').getByRole('switch').isDisabled(), true);
  await page.evaluate(() => hybridTest.save.resolve());
  await page.waitForFunction(() => !document.querySelector('[role=combobox]').disabled);
  await page.evaluate(() => hybridTest.term.focus());
  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+Alt+1');
  await page.keyboard.press('Control+Shift+b');
  assert.deepEqual(await page.evaluate(() => hybridTest.bytes), ['\x02']);
  assert.deepEqual(await page.evaluate(() => hybridTest.actions), ['navigationHosts', 'toggleSidebarAlternative']);
  await page.locator('#outside-field').focus();
  await page.keyboard.press('Control+Alt+1');
  assert.deepEqual(await page.evaluate(() => hybridTest.actions), ['navigationHosts', 'toggleSidebarAlternative']);

  await search.fill('Settings');
  const settings = row('Settings');
  const recorder = settings.getByRole('button', { name: /^Settings: / });
  await recorder.click();
  await page.keyboard.press('Control+b');
  await settings.getByRole('status').filter({ hasText: 'Already used by Toggle Hosts / Sidebar' }).waitFor();
  assert.equal(await page.evaluate(() => hybridTest.writes.length), 1, 'conflicts never reach persistence');
  assert.equal(await recorder.evaluate(node => node === document.activeElement), true);
  await recorder.click();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => hybridTest.writes.length), 1, 'Escape cancels without saving');
  await recorder.click();
  await page.locator('#outside-field').focus();
  assert.equal(await recorder.textContent(), 'Ctrl+,', 'moving focus away cancels recording');
  await recorder.click();
  await page.keyboard.press('Control+Alt+k');
  await page.waitForFunction(() => hybridTest.writes.length === 2);
  assert.equal(await page.evaluate(() => hybridTest.store.getState().settings.keybindings.toggleSettings), 'Mod+Alt+K');
  await page.evaluate(() => hybridTest.save.reject(new Error('Fixture binding save failed')));
  await page.waitForFunction(() => hybridTest.toasts.length === 1);
  assert.equal(await recorder.textContent(), 'Ctrl+,', 'failed binding save rolls back');
  await recorder.click();
  await page.keyboard.press('Control+Alt+k');
  await page.evaluate(() => hybridTest.save.resolve());
  await page.waitForFunction(() => !document.querySelector('[aria-label="Remove shortcut for Settings"]').disabled);
  assert.equal(await recorder.textContent(), 'Ctrl+Alt+K');
  assert.equal(await recorder.evaluate(node => node === document.activeElement), true, 'successful recording retains keyboard focus');
  await settings.getByRole('button', { name: 'Remove shortcut for Settings', exact: true }).click();
  await page.evaluate(() => hybridTest.save.resolve());
  await page.waitForFunction(() => hybridTest.store.getState().settings.keybindings.toggleSettings === '');
  assert.equal(await recorder.textContent(), 'Not set');
  assert.equal(await settings.getByRole('switch').isDisabled(), true, 'unbound reservations are dormant, not erased');
  await settings.getByRole('button', { name: 'Reset shortcut for Settings', exact: true }).click();
  await page.evaluate(() => hybridTest.save.resolve());
  await page.waitForFunction(() => !document.querySelector('[aria-label="Remove shortcut for Settings"]').disabled);
  assert.equal(await recorder.textContent(), 'Ctrl+,');
  assert.equal(await settings.getByRole('switch').getAttribute('aria-checked'), 'true');

  await search.fill('Split focused pane');
  await row('Split focused pane').getByText(/Also works with:/).waitFor();
  await search.fill('not-a-real-action');
  await page.getByRole('status').filter({ hasText: 'No matching shortcuts' }).waitFor();
  await search.fill('Show Hosts');
  await row('Show Hosts').getByRole('switch').click();
  await page.evaluate(() => hybridTest.save.reject(new Error('Fixture reservation save failed')));
  await page.waitForFunction(() => hybridTest.toasts.length === 2);
  assert.equal(await row('Show Hosts').getByRole('switch').getAttribute('aria-checked'), 'true');
  await page.setViewportSize({ width: 375, height: 750 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'narrow settings do not overflow');
  if (process.env.ZYNC_HYBRID_SCREENSHOT) await page.screenshot({ path: process.env.ZYNC_HYBRID_SCREENSHOT });
  await page.evaluate(() => { document.body.dataset.overlayGalleryTheme = 'light'; document.body.dataset.theme = 'light'; });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'light narrow settings do not overflow');
  assert.equal(await row('Show Hosts').getByRole('switch').getAttribute('aria-checked'), 'true', 'theme changes do not modify shortcut ownership');
  await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
  await page.getByRole('menuitem', { name: 'View & edit shortcuts…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
  await dialog.waitFor();
  const dialogSearch = dialog.getByRole('textbox', { name: 'Find a shortcut' });
  await dialogSearch.fill('Command Palette');
  assert.equal(await dialog.locator('[data-shortcut-label="Command Palette"]').count(), 1);
  assert.equal(await dialog.locator('[data-shortcut-label="Command Palette (alternative)"]').count(), 1, 'the independent secondary binding is listed');
  await dialogSearch.fill('Settings');
  const modalRecorder = dialog.getByRole('button', { name: /^Settings: / });
  await modalRecorder.click();
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true, 'Escape cancels recording before closing the modal');
  assert.equal(await modalRecorder.textContent(), 'Ctrl+,');
  await modalRecorder.click();
  await page.keyboard.press('Control+Alt+k');
  await page.evaluate(() => hybridTest.save.resolve());
  await page.waitForFunction(() => hybridTest.store.getState().settings.keybindings.toggleSettings === 'Mod+Alt+K');
  assert.equal(await modalRecorder.textContent(), 'Ctrl+Alt+K', 'modal uses the existing settings updater');
  assert.equal(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth), true, 'narrow modal does not overflow');
  await dialogSearch.focus();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await search.fill('Settings');
  assert.equal(await recorder.textContent(), 'Ctrl+Alt+K', 'Settings reflects modal edits without separate state');
  const openEditor = async () => {
    await page.getByRole('button', { name: 'Keyboard shortcuts', exact: true }).click();
    await page.getByRole('menuitem', { name: 'View & edit shortcuts…' }).click();
    await dialog.waitFor();
    await dialogSearch.fill('Settings');
  };
  await openEditor();
  await modalRecorder.click();
  await page.keyboard.press('F8');
  assert.equal(await modalRecorder.isDisabled(), true, 'pending recorder rejects new activation');
  assert.equal(await modalRecorder.evaluate(node => node === document.activeElement), true, 'pending save retains keyboard focus');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await openEditor();
  assert.equal(await modalRecorder.isDisabled(), true, 'reopening cannot bypass the shared pending save');
  await dialogSearch.focus();
  await page.evaluate(() => hybridTest.save.reject(new Error('Reopened editor save failed')));
  await page.waitForFunction(() => hybridTest.store.getState().pendingKeybindingWrites === 0);
  assert.equal(await modalRecorder.textContent(), 'Ctrl+Alt+K', 'failed write restores the saved binding');
  assert.equal(await dialogSearch.evaluate(node => node === document.activeElement), true, 'save completion does not steal focus');
  // Direct callers also share ordering; a failed write cannot poison the next rollback baseline.
  await page.evaluate(() => {
    hybridTest.queueResults = [];
    const update = hybridTest.store.getState().updateKeybindings;
    void update({ toggleSettings: 'F8' }).catch(() => hybridTest.queueResults.push('first failed'));
    void update({ toggleSettings: 'F9' }).catch(() => hybridTest.queueResults.push('second failed'));
  });
  await page.waitForFunction(() => hybridTest.store.getState().settings.keybindings.toggleSettings === 'F8');
  assert.equal(await page.evaluate(() => hybridTest.writes.at(-1).keybindings.toggleSettings), 'F8');
  await page.evaluate(() => hybridTest.save.reject(new Error('First queued save failed')));
  await page.waitForFunction(() => hybridTest.writes.at(-1).keybindings.toggleSettings === 'F9');
  await page.evaluate(() => hybridTest.save.reject(new Error('Second queued save failed')));
  await page.waitForFunction(() => hybridTest.store.getState().pendingKeybindingWrites === 0);
  assert.equal(await modalRecorder.textContent(), 'Ctrl+Alt+K', 'two failures restore the acknowledged baseline');
  assert.deepEqual(await page.evaluate(() => hybridTest.queueResults), ['first failed', 'second failed']);
  await modalRecorder.click();
  await page.keyboard.press('F8');
  await page.evaluate(() => hybridTest.save.resolve());
  await page.waitForFunction(() => hybridTest.store.getState().pendingKeybindingWrites === 0);
  assert.equal(await modalRecorder.evaluate(node => node === document.activeElement), true, 'success retains recorder focus');
  await modalRecorder.click();
  await page.keyboard.press('F9');
  await page.evaluate(() => hybridTest.save.reject(new Error('Focus failure test')));
  await page.waitForFunction(() => hybridTest.store.getState().pendingKeybindingWrites === 0);
  assert.equal(await modalRecorder.evaluate(node => node === document.activeElement), true, 'failure retains recorder focus');
  await dialogSearch.focus();
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  // Upgrade conflicts use the same settings UI and real xterm path, without
  // modifying the saved custom key or clearing its terminal-first policy.
  await page.setViewportSize({ width: 1000, height: 850 });
  await page.evaluate(() => {
    hybridTest.loadLegacyShortcuts(); hybridTest.actions.length = 0; hybridTest.bytes.length = 0; hybridTest.terminalKeys.length = 0;
  });
  await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); });
  await page.keyboard.press('Control+Alt+3');
  assert.deepEqual(await page.evaluate(() => hybridTest.actions), ['toggleSettings'], 'custom Settings wins over new Public URLs default');
  await page.evaluate(() => { hybridTest.actions.length = 0; hybridTest.term.focus(); });
  await page.keyboard.press('Control+Shift+b');
  assert.deepEqual(await page.evaluate(() => hybridTest.actions), [], 'a secondary cannot take over an unreserved custom key');
  assert.deepEqual(await page.evaluate(() => hybridTest.terminalKeys.filter(({ key }) => key.toLowerCase() === 'b')
    .map(({ key, allowed }) => ({ key: key.toLowerCase(), allowed }))),
    [{ key: 'b', allowed: true }], 'the original terminal input handler receives the key exactly once; encoding remains xterm-owned');
  await page.keyboard.press('Control+Shift+Space');
  assert.deepEqual(await page.evaluate(() => hybridTest.actions), ['commandPaletteAlternative'], 'non-conflicting secondary stays automatic');
  await search.fill('Toggle Hosts / Sidebar (alternative)');
  const sidebarAlternative = row('Toggle Hosts / Sidebar (alternative)');
  await sidebarAlternative.getByRole('status').filter({ hasText: 'Inactive:' }).waitFor();
  assert.equal(await sidebarAlternative.getByRole('switch').isDisabled(), true);
  assert.equal(await sidebarAlternative.getByRole('switch').getAttribute('aria-checked'), 'false');
  assert.ok(await page.evaluate(() => hybridTest.store.getState().settings.keyboard.terminalShortcutExceptions.includes('toggleSidebarAlternative')),
    'inactive defaults keep their saved reservations');
  await page.evaluate(() => hybridTest.store.setState(state => ({ settings: { ...state.settings,
    keybindings: { ...state.settings.keybindings, toggleSidebarAlternative: 'Mod+Alt+J' },
  } })));
  await sidebarAlternative.getByRole('button', { name: 'Reset shortcut for Toggle Hosts / Sidebar (alternative)', exact: true }).click();
  await page.evaluate(() => hybridTest.save.resolve());
  await page.waitForFunction(() => hybridTest.store.getState().pendingKeybindingWrites === 0);
  await sidebarAlternative.getByRole('status').filter({ hasText: 'Inactive:' }).waitFor();
  assert.equal(await page.evaluate(() => hybridTest.store.getState().settings.keybindings.commandPalette), 'Mod+Shift+B',
    'resetting a default never overwrites its custom blocker');
  for (const action of ['Reset', 'Remove']) {
    await page.evaluate(() => hybridTest.store.setState(state => ({ settings: { ...state.settings,
      keybindings: { ...state.settings.keybindings, commandPalette: 'Mod+Shift+B' },
    } })));
    await search.fill('Command Palette');
    await row('Command Palette').getByRole('button', { name: action + ' shortcut for Command Palette', exact: true }).click();
    await page.evaluate(() => hybridTest.save.resolve());
    await page.waitForFunction(() => hybridTest.store.getState().pendingKeybindingWrites === 0);
    await search.fill('Toggle Hosts / Sidebar (alternative)');
    assert.equal(await sidebarAlternative.getByRole('switch').isDisabled(), false);
    assert.equal(await sidebarAlternative.getByRole('switch').getAttribute('aria-checked'), 'true');
    await page.evaluate(() => { hybridTest.actions.length = 0; hybridTest.term.focus(); });
    await page.keyboard.press('Control+Shift+b');
    assert.deepEqual(await page.evaluate(() => hybridTest.actions), ['toggleSidebarAlternative'], action + ' revives the configured secondary');
    assert.equal(await page.evaluate(() => hybridTest.store.getState().settings.keybindings.toggleSettings), 'Mod+Alt+3');
  }
  assert.deepEqual(errors, []);
  console.log('Hybrid settings: reservations, real xterm ownership, upgrade conflicts, inactive defaults, recording focus/Escape, rollback, remove/reset, aliases, search and narrow layout passed.');
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
