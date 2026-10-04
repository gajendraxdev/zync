/** Real xterm/DOM input regression. Uses a headless browser, never a live SSH session. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const modules = [
  'features/shortcuts/route', 'features/shortcuts/catalog', 'features/shortcuts/policy', 'features/shortcuts/focus',
  'lib/shortcuts', 'lib/terminal/terminalKeyRouting', 'lib/terminal/ptyKeyTranslations',
  'lib/terminal/terminalInteraction', 'lib/terminal/terminalClipboard', 'lib/terminal/terminalShellContext',
  'lib/ghostSuggestions/inputTracker', 'lib/ghostSuggestions/escapeInput',
];
// Bundler-style source imports can remain extensionless in the test compiler output.
const files = new Map(modules.flatMap(name => [
  [`/${name}.js`, `../.tmp-agent-tests/src/${name}.js`],
  [`/${name}`, `../.tmp-agent-tests/src/${name}.js`],
]));
files.set('/xterm.js', '../node_modules/@xterm/xterm/lib/xterm.js');
files.set('/xterm.css', '../node_modules/@xterm/xterm/css/xterm.css');
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><link rel="stylesheet" href="/xterm.css"><script src="/xterm.js"></script><style>.host{height:220px;width:640px}</style><div id="one" class="host"></div><div id="two" class="host"></div><input id="field">');
      return;
    }
    const file = files.get(req.url);
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript');
    res.end(await readFile(new URL(file, import.meta.url)));
  } catch { res.writeHead(500); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const mod = await page.evaluate(() => /mac/i.test(navigator.platform) ? 'Meta' : 'Control');
  await page.evaluate(async () => {
    const { routeShortcut } = await import('/features/shortcuts/route.js');
    const { SHORTCUT_CATALOG } = await import('/features/shortcuts/catalog.js');
    const { DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS } = await import('/features/shortcuts/policy.js');
    const { keyboardEventFocus, ownsLocalKeyboard } = await import('/features/shortcuts/focus.js');
    const { routeTerminalKey } = await import('/lib/terminal/terminalKeyRouting.js');
    const { registerTerminalInteraction, pasteIntoTerminal } = await import('/lib/terminal/terminalInteraction.js');
    const { canTrackTerminalShell, observeTerminalShellContext } = await import('/lib/terminal/terminalShellContext.js');
    const { InputTracker } = await import('/lib/ghostSuggestions/inputTracker.js');
    const state = window.inputTest = {
      policy: 'shell', actions: [], bytes: [[], []], generations: [1, 1], targets: [], terms: [], trackers: [],
      exceptions: [...DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS],
      observers: [], history: [], cleanups: [], pasteIntoTerminal, canTrackTerminalShell,
    };
    for (const [index, id] of ['one', 'two'].entries()) {
      const term = new window.Terminal();
      term.open(document.getElementById(id));
      state.terms.push(term);
      const tracker = new InputTracker({ onLineChange: () => {}, onDismiss: () => {},
        onAccept: suffix => state.bytes[index].push(suffix), onHistoryCommit: text => state.history.push(text) });
      state.trackers.push(tracker);
      state.observers.push(observeTerminalShellContext(term, {
        isPaused: () => false, generation: () => state.generations[index], invalidate: () => tracker.suspend(),
      }));
      term.attachCustomKeyEventHandler(event => routeTerminalKey(event, bytes => state.bytes[index].push(bytes)));
      term.onData(data => {
        state.observers[index].sync();
        if (canTrackTerminalShell(term) && tracker.feed(data).consumed) return;
        state.bytes[index].push(data);
      });
      const target = {
        root: term.element, isAvailable: () => term.element.isConnected, epoch: () => state.generations[index],
        selection: () => term.getSelection(), paste: text => term.paste(text), focus: () => term.focus(),
      };
      state.targets.push(target);
      state.cleanups.push(registerTerminalInteraction(target));
    }
    window.addEventListener('keydown', event => {
      if (state.skipRouting || ownsLocalKeyboard(event)) return;
      if (routeShortcut(event, keyboardEventFocus(event), state.policy, SHORTCUT_CATALOG, {}, id => { state.actions.push(id); return true; }, state.exceptions)) {
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, { capture: true });
    state.terms[0].focus();
  });

  await page.keyboard.press('Control+b');
  await page.keyboard.press('Control+p');
  assert.deepEqual(await page.evaluate(() => inputTest.bytes), [['\x02', '\x10'], []], 'tmux prefix and previous-history bytes reach only focused xterm once');
  assert.deepEqual(await page.evaluate(() => inputTest.actions), []);
  await page.keyboard.press(`${mod}+Shift+p`);
  await page.keyboard.press('Control+Shift+s');
  assert.deepEqual(await page.evaluate(() => inputTest.actions), ['commandPaletteMode', 'snippetsFeature']);
  assert.deepEqual(await page.evaluate(() => inputTest.bytes[0]), ['\x02', '\x10'], 'reserved shortcuts never also write to the PTY');
  await page.evaluate(() => { inputTest.exceptions = []; inputTest.actions = []; inputTest.bytes = [[], []]; });
  await page.keyboard.press('Control+Shift+s');
  assert.deepEqual(await page.evaluate(() => inputTest.actions), [], 'disabled exception is not dispatched');
  const unreservedBytes = await page.evaluate(() => inputTest.bytes[0]);
  await page.evaluate(() => { inputTest.skipRouting = true; inputTest.bytes = [[], []]; });
  await page.keyboard.press('Control+Shift+s');
  assert.deepEqual(await page.evaluate(() => inputTest.bytes[0]), unreservedBytes, 'disabled exception behaves like unmodified xterm, including non-encoded chords');
  // Reset before the remaining app-first, focus and clipboard regressions.
  await page.evaluate(() => { inputTest.skipRouting = false; inputTest.bytes[0] = ['\x02', '\x10']; });
  await page.evaluate(() => { inputTest.policy = 'app'; });
  await page.keyboard.press(`${mod}+b`);
  assert.deepEqual(await page.evaluate(() => inputTest.actions), ['toggleSidebar']);
  assert.deepEqual(await page.evaluate(() => inputTest.bytes[0]), ['\x02', '\x10'], 'app shortcut does not also send terminal bytes');

  // A local dialog and a binding recorder beat global capture order.
  await page.evaluate(() => {
    const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<input id="dialog-input">'; document.body.append(dialog);
    document.getElementById('dialog-input').focus();
  });
  await page.keyboard.press(`${mod}+b`);
  assert.deepEqual(await page.evaluate(() => inputTest.actions), ['toggleSidebar']);
  await page.evaluate(() => {
    document.querySelector('[role=dialog]').remove();
    const field = document.getElementById('field');
    field.dataset.zyncShortcutRecording = 'true'; field.focus();
  });
  await page.keyboard.press(`${mod}+p`);
  assert.deepEqual(await page.evaluate(() => inputTest.actions), ['toggleSidebar']);

  const safety = await page.evaluate(async () => {
    const s = inputTest;
    delete document.getElementById('field').dataset.zyncShortcutRecording;
    s.policy = 'shell'; s.terms[0].focus(); s.bytes = [[], []];
    let resolve;
    const pending = s.pasteIntoTerminal(s.targets[0], () => new Promise(done => { resolve = done; }));
    s.terms[1].focus(); resolve('do not paste'); await pending;
    const cancelled = s.bytes.every(items => items.length === 0);
    s.terms[0].focus();
    await new Promise(done => s.terms[0].write('\x1b[?2004h', done));
    await s.pasteIntoTerminal(s.targets[0], async () => 'hello\nworld');
    const paste = s.bytes[0].join('');
    s.bytes = [[], []];
    s.trackers[0].setSuggestion('WRONG');
    await new Promise(done => s.terms[0].write('\x1b[?1049h', done));
    return { cancelled, paste, safe: s.canTrackTerminalShell(s.terms[0]), desynced: s.trackers[0].isDesynced() };
  });
  assert.equal(safety.cancelled, true, 'moving focus cancels a pending paste');
  assert.equal(safety.paste, '\x1b[200~hello\rworld\x1b[201~', 'xterm bracketed paste preserved without auto-submit');
  assert.equal(safety.safe, false);
  assert.equal(safety.desynced, true);
  await page.keyboard.press('ArrowRight');
  assert.deepEqual(await page.evaluate(() => inputTest.bytes[0]), ['\x1b[C'], 'alternate-screen arrow cannot accept stale suggestion');

  const modes = await page.evaluate(async () => {
    const s = inputTest, term = s.terms[0];
    await new Promise(done => term.write('\x1b[?1049l\x1b[?1000h', done));
    const reporting = term.modes.mouseTrackingMode;
    const unsafe = !s.canTrackTerminalShell(term);
    await new Promise(done => term.write('\x1b[?1000l', done));
    const normal = s.canTrackTerminalShell(term);
    s.cleanups.forEach(dispose => dispose());
    s.observers.forEach(observer => observer.dispose());
    s.terms.forEach(item => item.dispose());
    return { reporting, unsafe, normal, history: s.history };
  });
  assert.deepEqual(modes, { reporting: 'vt200', unsafe: true, normal: true, history: [] }, 'observers preserve xterm mouse modes and do not record full-screen input');
  console.log('Real-browser xterm routing, dialog/recorder ownership, paste and mode-safety regressions passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
