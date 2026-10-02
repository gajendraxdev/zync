/** Optional real-browser regression: compile agent tests, then run with Playwright installed. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

// An explicit module URL allows CI/local bundled runtimes without adding a production dependency.
const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const files = new Map([
  ['/xterm.js', '../node_modules/@xterm/xterm/lib/xterm.js'],
  ['/webgl.js', '../node_modules/@xterm/addon-webgl/lib/addon-webgl.js'],
  ['/xterm.css', '../node_modules/@xterm/xterm/css/xterm.css'],
  ['/terminal/terminalDocument.js', '../.tmp-agent-tests/src/lib/terminal/terminalDocument.js'],
  ['/cspStyleNonce.js', '../.tmp-agent-tests/src/lib/cspStyleNonce.js'],
]);
const nonce = 'terminal-regression-test-nonce';
const html = `<!doctype html><html><head>
<link rel="stylesheet" href="/xterm.css">
<style nonce="${nonce}">body { font-family: sans-serif; } .host { width: 600px; height: 160px; }</style>
<script src="/xterm.js"></script><script src="/webgl.js"></script>
</head><body><div id="one" class="host"></div><div id="two" class="host"></div></body></html>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url === '/dev') {
      if (req.url === '/') res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' 'nonce-${nonce}'`);
      res.setHeader('Content-Type', 'text/html');
      res.end(req.url === '/dev' ? html.replace(` nonce="${nonce}"`, '') : html);
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
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const baseline = await page.evaluate(async () => {
    const term = new window.Terminal({ fontFamily: 'monospace', fontSize: 17 });
    term.open(document.getElementById('one'));
    await new Promise(resolve => term.write('raw terminal', resolve));
    const family = getComputedStyle(term.element.querySelector('.xterm-rows')).fontFamily;
    const blockedStyles = [...term.element.querySelectorAll('style')].filter(style => style.sheet === null).length;
    term.dispose();
    return { family, blockedStyles };
  });
  assert.match(baseline.family, /sans-serif/, 'unpatched release renderer reproduces raw inherited font');
  assert.ok(baseline.blockedStyles >= 2, 'release CSP blocks xterm theme and dimensions styles');

  const fixed = await page.evaluate(async () => {
    const { getTerminalDocument } = await import('/terminal/terminalDocument.js');
    const adapter = getTerminalDocument(document);
    const original = document.createElement;
    const terms = ['one', 'two'].map(id => {
      const term = new window.Terminal({ documentOverride: adapter, fontFamily: 'monospace', fontSize: 17, cursorBlink: true, theme: { foreground: '#abcdef', red: '#ff0000' } });
      term.open(document.getElementById(id));
      return term;
    });
    for (const term of terms) await new Promise(resolve => term.write('\x1b[31mRED\x1b[0m cursor', resolve));
    const inspect = term => {
      const rows = term.element.querySelector('.xterm-rows');
      const styles = [...term.element.querySelectorAll('style')];
      return {
        family: getComputedStyle(rows).fontFamily,
        size: getComputedStyle(rows).fontSize,
        color: getComputedStyle(rows.querySelector('.xterm-fg-1')).color,
        cursor: Boolean(rows.querySelector('.xterm-cursor')),
        stylesAllowed: styles.length >= 2 && styles.every(style => style.nonce && style.sheet),
        styleDetails: styles.map(style => ({ nonce: style.nonce, allowed: Boolean(style.sheet), css: style.textContent.slice(0, 100) })),
      };
    };
    const initial = [];
    for (const term of terms) {
      term.focus();
      term.refresh(0, term.rows - 1);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      initial.push(inspect(term));
    }
    terms[0].focus();
    terms[0].options.fontSize = 19;
    terms[0].options.theme = { red: '#00ff00' };
    terms[0].resize(50, 8);
    terms[0].element.parentElement.style.display = 'none';
    terms[0].element.parentElement.style.display = '';
    terms[0].refresh(0, 7);
    await new Promise(requestAnimationFrame);
    const updated = inspect(terms[0]);
    const addon = new window.WebglAddon.WebglAddon();
    terms[0].loadAddon(addon);
    addon.dispose(); // Recreates xterm's DOM renderer using the same adapter.
    await new Promise(requestAnimationFrame);
    const fallback = inspect(terms[0]);
    const unrelated = document.createElement('style');
    unrelated.textContent = 'body { color: red; }';
    document.head.appendChild(unrelated);
    const isolated = document.createElement === original && unrelated.nonce === '' && unrelated.sheet === null;
    unrelated.remove();
    terms.forEach(term => term.dispose());
    return { initial, updated, fallback, isolated, disposed: document.querySelectorAll('.xterm').length === 0 };
  });
  for (const term of fixed.initial) {
    assert.equal(term.family, 'monospace');
    assert.equal(term.size, '17px');
    assert.equal(term.color, 'rgb(255, 0, 0)');
    assert.equal(term.cursor, true, JSON.stringify(fixed));
    assert.equal(term.stylesAllowed, true, JSON.stringify(fixed));
  }
  for (const term of [fixed.updated, fixed.fallback]) {
    assert.equal(term.size, '19px');
    assert.equal(term.color, 'rgb(0, 255, 0)');
    assert.equal(term.stylesAllowed, true);
    assert.equal(term.cursor, true);
  }
  assert.equal(fixed.isolated, true, 'unrelated styles remain blocked; host policy is unchanged');
  assert.equal(fixed.disposed, true);
  await page.goto(`${origin}/dev`);
  assert.equal(await page.evaluate(async () => {
    const { getTerminalDocument } = await import('/terminal/terminalDocument.js');
    return getTerminalDocument(document) === document;
  }), true);
  console.log('Real-browser terminal CSP reproduction and regression passed.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
