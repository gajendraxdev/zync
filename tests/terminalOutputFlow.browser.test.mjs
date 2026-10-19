/** Repeatable real-parser stress check; never touches native terminals, hosts or credentials. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const xtermCss = await readFile(new URL('../node_modules/@xterm/xterm/css/xterm.css', import.meta.url));
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./terminalOutputFlow.browser.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'esm',
  plugins: [{ name: 'terminal-store-boundary', setup(builder) {
    builder.onResolve({ filter: /store\/useAppStore(?:\.js)?$/ }, () => ({ path: 'store', namespace: 'terminal-boundary' }));
    builder.onLoad({ filter: /.*/, namespace: 'terminal-boundary' }, () => ({ contents: 'export const useAppStore = { getState: () => ({ setTerminalCwd() {} }) };', loader: 'js' }));
  } }],
});
const server = createServer((request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><link rel="stylesheet" href="/xterm.css"><script type="module" src="/fixture.js"></script>');
  } else if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].text);
  } else if (request.url === '/xterm.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(xtermCss);
  } else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => typeof window.runOutputFlowBrowserChecks === 'function');
  const results = await page.evaluate(() => window.runOutputFlowBrowserChecks());
  assert.deepEqual(pageErrors, [], 'no unhandled errors may escape parser/ordered-channel callbacks');
  console.log(JSON.stringify(results, null, 2));
  console.log('Real-browser terminal output flow stress checks passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
