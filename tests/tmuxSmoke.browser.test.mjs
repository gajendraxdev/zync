/** Optional real tmux + xterm smoke test. Never connects to a user's SSH host. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({ stdin: { contents: `
  import { Terminal } from '@xterm/xterm';
  import { routeShortcut } from './src/features/shortcuts/route';
  import { SHORTCUT_CATALOG } from './src/features/shortcuts/catalog';
  import { keyboardEventFocus, ownsLocalKeyboard } from './src/features/shortcuts/focus';
  import { routeTerminalKey } from './src/lib/terminal/terminalKeyRouting';
  const term = window.smokeTerm = new Terminal({ cols: 80, rows: 24 });
  window.smokeActions = [];
  term.open(document.getElementById('terminal'));
  term.attachCustomKeyEventHandler(event => routeTerminalKey(event, data => { void window.sendPtyInput(data); }));
  term.onData(data => { void window.sendPtyInput(data); });
  window.addEventListener('keydown', event => {
    if (ownsLocalKeyboard(event)) return;
    if (routeShortcut(event, keyboardEventFocus(event), 'shell', SHORTCUT_CATALOG, {}, id => { window.smokeActions.push(id); return true; })) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);
  term.focus();
`, loader: 'ts', resolveDir: root }, bundle: true, write: false, format: 'esm', platform: 'browser' });
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url === '/test.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/test.js' ? bundle.outputFiles[0].text : '<!doctype html><div id="terminal"></div><script type="module" src="/test.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser, processHandle, lines, exited;
let output = Promise.resolve();
let detached = false;
let sequence = 0;
const pending = new Map();
const request = (action, values = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`tmux test timed out: ${action}`)); }, 5000);
  pending.set(id, { resolve: result => { clearTimeout(timeout); resolve(result); }, reject: error => { clearTimeout(timeout); reject(error); } });
  processHandle.stdin.write(`${JSON.stringify({ id, action, ...values })}\n`);
});
async function until(condition, label) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`tmux smoke failed: ${label}`);
}
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.exposeFunction('sendPtyInput', text => request('input', { text }));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => Boolean(window.smokeTerm));
  const harness = fileURLToPath(new URL('./tmuxPtyHarness.py', import.meta.url));
  const linuxPath = harness.replace(/^([A-Za-z]):/, (_, drive) => `/mnt/${drive.toLowerCase()}`).replaceAll('\\', '/');
  processHandle = process.platform === 'win32'
    ? spawn('wsl', ['-d', process.env.ZYNC_TMUX_WSL_DISTRO || 'Ubuntu', '--', 'python3', '-u', linuxPath], { windowsHide: true })
    : spawn('python3', ['-u', harness]);
  exited = new Promise(resolve => processHandle.once('close', resolve));
  const failPending = error => { for (const task of pending.values()) task.reject(error); pending.clear(); };
  processHandle.on('error', failPending);
  processHandle.stdin.on('error', failPending);
  processHandle.stderr.on('data', data => errors.push(data.toString()));
  lines = createInterface({ input: processHandle.stdout });
  lines.on('line', line => {
    const message = JSON.parse(line);
    if (message.output) output = output.then(() => page.evaluate(data => new Promise(resolve => {
      smokeTerm.write(Uint8Array.from(atob(data), character => character.charCodeAt(0)), resolve);
    }), message.output)).catch(error => { errors.push(error.message); });
    if (message.detached) detached = true;
    const task = pending.get(message.id);
    if (task) { pending.delete(message.id); message.error ? task.reject(new Error(message.error)) : task.resolve(message.result); }
  });
  const panes = async () => (await request('panes')).trim().split('\n').map(row => row.split('\t'));
  await until(async () => { try { return (await panes()).length === 1; } catch { return false; } }, 'initial tmux session');
  await output;
  await page.keyboard.press('Control+b'); await page.keyboard.type('%');
  await until(async () => (await panes()).length === 2, 'prefix creates exactly two panes');
  const beforeSwitch = (await panes()).find(row => row[1] === '1')[0];
  await page.keyboard.press('Control+b'); await page.keyboard.press('ArrowLeft');
  await until(async () => (await panes()).find(row => row[1] === '1')[0] !== beforeSwitch, 'pane focus changes');
  await page.keyboard.type('sleep 30'); await page.keyboard.press('Enter');
  await until(async () => (await panes()).some(row => row[1] === '1' && row[2] === 'sleep'), 'test command starts');
  await page.keyboard.press('Control+c');
  await until(async () => (await panes()).some(row => row[1] === '1' && row[2] === 'bash'), 'Ctrl+C returns to shell');
  await page.keyboard.press('Control+p'); await page.keyboard.press('Control+u');
  assert.deepEqual(await page.evaluate(() => smokeActions), [], 'ordinary terminal controls never open app UI');
  const mod = await page.evaluate(() => /mac/i.test(navigator.platform) ? 'Meta' : 'Control');
  await page.keyboard.press(`${mod}+Shift+p`); await page.keyboard.press('Control+Shift+s');
  assert.deepEqual(await page.evaluate(() => smokeActions), ['commandPaletteMode', 'snippetsFeature']);
  await page.evaluate(() => smokeTerm.resize(110, 32));
  await request('resize', { cols: 110, rows: 32 });
  await until(async () => (await panes()).every(row => row[3] === '110'), 'resize reaches tmux');
  await page.keyboard.type('tmux set-option -g mouse on'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => smokeTerm.modes.mouseTrackingMode !== 'none');
  await page.keyboard.type('tmux set-option -g mouse off'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => smokeTerm.modes.mouseTrackingMode === 'none');
  await page.keyboard.press('Control+b'); await page.keyboard.type('d');
  await until(() => detached, 'client detaches');
  await output;
  assert.equal(await page.evaluate(() => smokeTerm.buffer.active.type), 'normal', 'detach restores the normal screen');
  assert.equal((await panes()).length, 2, 'detached session keeps its panes');
  detached = false;
  await request('attach');
  await page.waitForFunction(() => smokeTerm.buffer.active.type === 'alternate');
  assert.equal((await panes()).length, 2, 'reattachment restores the same session');
  await request('close'); await exited; await output;
  assert.deepEqual(errors, []);
  console.log('Real tmux: split, pane focus, Ctrl+C/P, reserved shortcuts, resize, mouse modes, detach and reattach passed. Private test server removed.');
} finally {
  processHandle?.stdin.end();
  if (exited) await exited;
  lines?.close();
  for (const task of pending.values()) task.reject(new Error('test closed'));
  await output.catch(() => {});
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
