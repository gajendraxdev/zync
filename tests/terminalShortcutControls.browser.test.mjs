/** Real React controls and the production keyboard-settings updater, with only persistence mocked. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const path = relative => fileURLToPath(new URL(relative, import.meta.url)).replaceAll('\\', '/');
const settingsSource = ts.createSourceFile('settingsSlice.ts', await readFile(new URL('../src/store/settingsSlice.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const updaters = [];
function visit(node) {
  if (ts.isPropertyAssignment(node) && node.name.getText(settingsSource) === 'updateKeyboardSettings') updaters.push(node.initializer.getText(settingsSource));
  ts.forEachChild(node, visit);
}
visit(settingsSource);
assert.equal(updaters.length, 1, 'test must exercise exactly the production updater');
const storeModule = `
import { create } from 'zustand';
import { normalizeKeyboardSettings } from ${JSON.stringify(path('../src/features/shortcuts/policy.ts'))};
const persistSettings = async patch => {
  window.controlsTest.writes.push(patch);
  await new Promise((resolve, reject) => { window.controlsTest.save = { resolve, reject }; });
};
export const useAppStore = create((set, get) => ({
  settings: { keyboard: normalizeKeyboardSettings(undefined), terminal: { fontSize: 14, gpuAcceleration: true, cursorStyle: 'block' } },
  terminals: { local: [] }, paneLayouts: { local: {} }, activePaneGroupOwner: {},
  updateTerminalSettings: async () => {},
  showToast: (kind, text) => window.controlsTest.toasts.push({ kind, text }),
  updateKeyboardSettings: ${updaters[0]},
}));
window.controlsTest = { store: useAppStore, writes: [], toasts: [], editorSaves: 0, editorCloses: 0, bytes: [] };
`;
const bundle = await build({
  stdin: { contents: `
    import React, { useState, useRef, useEffect } from 'react';
    import { createRoot } from 'react-dom/client';
    import { TerminalShortcutControl } from ${JSON.stringify(path('../src/components/settings/common/TerminalShortcutControl.tsx'))};
    import { TerminalQuickSettings } from ${JSON.stringify(path('../src/components/snippets/TerminalQuickSettings.tsx'))};
    import { PlainFileEditor } from ${JSON.stringify(path('../src/components/PlainFileEditor.tsx'))};
    import { ContextMenu } from ${JSON.stringify(path('../src/components/ui/ContextMenu.tsx'))};
    import { CombinedTabBar } from ${JSON.stringify(path('../src/components/layout/CombinedTabBar.tsx'))};
    import { useTerminalSearch } from ${JSON.stringify(path('../src/components/terminal/useTerminalSearch.ts'))};
    import { TerminalSearchBar } from ${JSON.stringify(path('../src/components/terminal/TerminalSearchBar.tsx'))};
    import { registerTerminalInteraction } from ${JSON.stringify(path('../src/lib/terminal/terminalInteraction.ts'))};
    import { terminalCache } from ${JSON.stringify(path('../src/lib/terminal/terminalCache.ts'))};
    import { Terminal } from '@xterm/xterm';
    import { SearchAddon } from '@xterm/addon-search';
    import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
    function FindFixture({ index }) {
      const { term, addon } = window.controlsTest.findTerms[index];
      const termRef = useRef(term);
      const addonRef = useRef(addon);
      const search = useTerminalSearch({ termRef, searchAddonRef: addonRef });
      useEffect(() => registerTerminalInteraction({ root: term.element, isAvailable: () => true,
        epoch: () => 1, selection: () => '', paste: () => {}, focus: () => term.focus(), find: search.openSearch }), [term, search.openSearch]);
      return <section id={'find-' + index} style={{ position: 'relative', height: 70 }}><TerminalSearchBar
        isOpen={search.isSearchOpen} searchText={search.searchText} inputRef={search.searchInputRef}
        onSearchTextChange={search.handleSearchTextChange} onNext={search.handleNext} onPrev={search.handlePrev} onClose={search.handleClose} /></section>;
    }
    function BarFixture() {
      const [bar, setBar] = useState({ activeView: 'terminal', activeTerminalId: 'find-one' });
      window.controlsTest.setBar = setBar;
      return <CombinedTabBar connectionId="local" tabId="test-bar" {...bar} openFeatures={[]} featureTabs={[]}
        activeFeatureTabId={null} pinnedFeatures={[]} onTabSelect={() => {}} onFeatureClose={() => {}}
        onFeatureTabSelect={() => {}} onFeatureTabClose={() => {}} onTerminalClose={() => {}}
        onNewTerminal={() => {}} onTogglePin={() => {}} />;
    }
    function MenuFixture() {
      const [open, setOpen] = useState(false);
      window.controlsTest.openMenu = () => setOpen(true);
      return open ? <ContextMenu x={10} y={10} items={[{ label: 'Test menu action', action: () => {} }]} onClose={() => setOpen(false)} /> : null;
    }
    window.controlsTest.findTerms = ['terminal', 'terminal-two'].map((id, index) => {
      const term = new Terminal();
      term.open(document.getElementById(id));
      const addon = new SearchAddon(); term.loadAddon(addon);
      terminalCache.set(index === 0 ? 'find-one' : 'find-two', { term, spawned: true });
      return { term, addon };
    });
    const term = window.controlsTest.term = window.controlsTest.findTerms[0].term;
    term.onData(bytes => window.controlsTest.bytes.push(bytes));
    createRoot(document.getElementById('root')).render(<TooltipProvider>
      <section id="bar" style={{ gridColumn: '1 / -1' }}><BarFixture /></section>
      <FindFixture index={0} /><FindFixture index={1} />
      <section id="sidebar"><TerminalShortcutControl compact /></section>
      <section id="settings"><TerminalShortcutControl showExceptions /></section>
      <section id="quick"><TerminalQuickSettings /></section>
      <section id="editor"><PlainFileEditor filename="test.txt" initialContent="test content"
        onSave={async () => { window.controlsTest.editorSaves++; }} onClose={() => { window.controlsTest.editorCloses++; }} /></section>
      <MenuFixture />
    </TooltipProvider>);
  `, resolveDir: path('../'), loader: 'tsx' },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"' },
  plugins: [{ name: 'test-settings-store', setup(builder) {
    builder.onResolve({ filter: /store\/useAppStore$/ }, () => ({ path: 'settings-store', namespace: 'test-store' }));
    builder.onLoad({ filter: /.*/, namespace: 'test-store' }, () => ({ contents: storeModule, loader: 'ts', resolveDir: path('../') }));
  } }],
});
const assets = await readdir(new URL('../dist/assets/', import.meta.url)).catch(() => []);
const styleName = assets.find(name => /^index-.*\.css$/.test(name));
const styles = styleName ? await readFile(new URL(`../dist/assets/${styleName}`, import.meta.url), 'utf8') : '';
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><link rel="stylesheet" href="/styles.css"><style>html,body,#root{height:auto;overflow:visible!important}body{color:#e4e4e7;padding:20px}#root{display:grid;grid-template-columns:220px 480px 220px;gap:20px}#quick{height:390px;overflow:hidden}#editor{position:relative;height:180px;grid-column:1/-1}</style><body style="background-color:#09090b!important"><div id="root"></div><div id="terminal"></div><div id="terminal-two"></div><script type="module" src="/test.js"></script></body>');
  } else if (req.url === '/test.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles[0].text);
  } else if (req.url === '/styles.css') {
    res.setHeader('Content-Type', 'text/css'); res.end(styles);
  } else { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const find = page.getByRole('button', { name: 'Find in terminal', exact: true });
  await find.click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#find-0 input'));
  assert.equal(await page.locator('#find-1 input').count(), 0, 'Find targets only the selected shell');
  await page.locator('#find-0 input').press('Escape');
  // The layout's focused leaf, not the last active shell ID, owns toolbar Find.
  await page.evaluate(() => controlsTest.store.setState({ paneLayouts: { local: { 'find-one': {
    version: 1, activePaneId: 'pane-two', root: { type: 'split', id: 'split-test', direction: 'horizontal', sizes: [0.5, 0.5],
      children: [ { type: 'pane', id: 'pane-one', content: { kind: 'term', termId: 'find-one' } },
        { type: 'pane', id: 'pane-two', content: { kind: 'term', termId: 'find-two' } } ] },
  } } } }));
  await find.click();
  await page.waitForFunction(() => document.activeElement === document.querySelector('#find-1 input'));
  assert.equal(await page.locator('#find-0 input').count(), 0);
  await page.locator('#find-1 input').press('Escape');
  await page.evaluate(() => {
    const groups = controlsTest.store.getState().paneLayouts.local;
    const layout = groups['find-one'];
    controlsTest.store.setState({ paneLayouts: { local: { 'find-one': { ...layout,
      root: { ...layout.root, children: [layout.root.children[0],
        { type: 'pane', id: 'pane-two', content: { kind: 'feature', featureId: 'files' } }] },
    } } } });
  });
  await find.waitFor({ state: 'detached' });
  assert.equal(await page.getByPlaceholder('Find...', { exact: true }).count(), 0, 'feature focus must not open search in a hidden or neighboring shell');
  await page.evaluate(() => controlsTest.setBar({ activeView: 'files', activeTerminalId: 'find-one' }));
  await find.waitFor({ state: 'detached' });
  await page.evaluate(() => {
    controlsTest.store.setState({ paneLayouts: { local: {} } });
    controlsTest.setBar({ activeView: 'terminal', activeTerminalId: 'find-one' });
  });
  assert.deepEqual(await page.evaluate(() => controlsTest.bytes), [], 'toolbar Find never writes to the PTY');
  const controls = page.getByRole('combobox', { name: 'Keyboard shortcuts' });
  await controls.first().waitFor();
  assert.equal(await controls.count(), 3, 'all three surfaces expose the same control');
  assert.equal(await page.getByText('Give keys to the shell').count(), 0);
  assert.deepEqual(await controls.allTextContents(), ['Terminal first', 'Terminal first', 'Terminal first']);
  await page.getByText('Customize terminal-first shortcuts', { exact: true }).click();
  const palette = page.getByRole('checkbox', { name: /Command Palette/ });
  const snippets = page.getByRole('checkbox', { name: /Snippets/ });
  assert.equal(await palette.isChecked(), true);
  assert.equal(await snippets.isChecked(), true);

  // The UI locks every surface during persistence and rolls an array back on failure.
  await snippets.uncheck();
  assert.equal(await snippets.isChecked(), false);
  assert.deepEqual(await controls.evaluateAll(nodes => nodes.map(node => node.disabled)), [true, true, true]);
  await page.evaluate(() => controlsTest.save.reject(new Error('Simulated save failure')));
  await page.waitForFunction(() => controlsTest.toasts.length === 1);
  assert.equal(await snippets.isChecked(), true, 'failed exception save restores production store value');
  assert.deepEqual(await controls.evaluateAll(nodes => nodes.map(node => node.disabled)), [false, false, false]);

  // Save an explicitly empty list, then reload it through normalization in the updater.
  await snippets.uncheck();
  await page.evaluate(() => controlsTest.save.resolve());
  await page.waitForFunction(() => !document.querySelector('#settings fieldset').disabled);
  await palette.uncheck();
  await page.evaluate(() => controlsTest.save.resolve());
  await page.waitForFunction(() => !document.querySelector('#settings fieldset').disabled);
  assert.deepEqual(await page.evaluate(() => controlsTest.writes.at(-1).keyboard.terminalShortcutExceptions), []);

  // Quick settings must use the same named policy, without erasing exceptions.
  const quickControl = page.locator('#quick').getByRole('combobox', { name: 'Keyboard shortcuts' });
  await quickControl.focus();
  await page.keyboard.press('ArrowDown');
  await page.getByRole('option', { name: /^Terminal first/ }).waitFor();
  const popup = page.locator('[data-zync-select-open]');
  assert.equal(await popup.evaluate(node => Boolean(node.closest('#quick'))), false, 'popup escapes the clipped quick-settings panel');
  const bounds = await popup.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height, 'popup fits the viewport');
  if (process.env.ZYNC_SHORTCUT_SCREENSHOT) await page.screenshot({ path: process.env.ZYNC_SHORTCUT_SCREENSHOT });
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  assert.deepEqual(await controls.allTextContents(), ['Zync first', 'Zync first', 'Zync first']);
  await page.evaluate(() => controlsTest.save.resolve());
  await page.waitForFunction(() => !document.querySelector('#sidebar [role=combobox]').disabled);
  assert.equal(await palette.isDisabled(), true, 'exception choices are inactive while app-first is enabled');
  assert.deepEqual(await page.evaluate(() => controlsTest.store.getState().settings.keyboard.terminalShortcutExceptions), []);
  await popup.waitFor({ state: 'detached' });
  await page.locator('#sidebar').getByRole('combobox', { name: 'Keyboard shortcuts' }).click();
  await page.getByRole('option', { name: /^Terminal first/ }).click();
  await page.evaluate(() => controlsTest.save.resolve());
  await page.waitForFunction(() => !document.querySelector('#settings fieldset').disabled);
  assert.equal(await palette.isChecked(), false, 'switching back preserves the empty exception list');
  await popup.waitFor({ state: 'detached' });

  // Dismissing the menu restores focus without saving a new policy.
  const sidebarControl = page.locator('#sidebar').getByRole('combobox', { name: 'Keyboard shortcuts' });
  const writesBeforeDismissal = await page.evaluate(() => controlsTest.writes.length);
  await sidebarControl.click();
  await popup.waitFor();
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'detached' });
  assert.equal(await sidebarControl.evaluate(node => document.activeElement === node), true);
  assert.equal(await page.evaluate(() => controlsTest.writes.length), writesBeforeDismissal);

  // A real mounted editor must not capture another pane's shell keys.
  await page.evaluate(() => controlsTest.term.focus());
  await page.keyboard.press('Control+s');
  await page.keyboard.press('Control+f');
  await page.keyboard.press('Control+w');
  assert.deepEqual(await page.evaluate(() => ({ bytes: controlsTest.bytes, saves: controlsTest.editorSaves, closes: controlsTest.editorCloses })),
    { bytes: ['\x13', '\x06', '\x17'], saves: 0, closes: 0 });
  assert.equal(await page.locator('#editor input').count(), 0, 'terminal Ctrl+F does not open editor search');
  await page.locator('#editor textarea').focus();
  const mod = await page.evaluate(() => /mac/i.test(navigator.platform) ? 'Meta' : 'Control');
  await page.keyboard.press(`${mod}+s`);
  await page.waitForFunction(() => controlsTest.editorSaves === 1);
  assert.equal(await page.evaluate(() => controlsTest.bytes.length), 3, 'editor still owns its own save key');

  // Escape belongs to a visible menu even if xterm still has DOM focus.
  await page.evaluate(() => { controlsTest.term.focus(); controlsTest.openMenu(); });
  await page.getByText('Test menu action', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByText('Test menu action', { exact: true }).waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(() => controlsTest.bytes.length), 3, 'menu Escape never reaches the PTY');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => controlsTest.bytes.at(-1)), '\x1b', 'menu handler is removed after dismissal');
  assert.deepEqual(errors, []);
  console.log('Terminal toolbar Find targeting, shared shortcut controls, exception persistence and rollback browser tests passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
