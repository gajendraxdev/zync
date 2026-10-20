/** Optional Windows/Chromium retention regression; no native PTYs, app profiles or SSH hosts. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const { chromium } = await import(process.env.ZYNC_PLAYWRIGHT_MODULE || 'playwright');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./terminalRendererMemory.browser.ts', import.meta.url))],
  bundle: true, write: false, platform: 'browser', format: 'iife',
});
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 600 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addStyleTag({ content: await readFile(new URL('../node_modules/@xterm/xterm/css/xterm.css', import.meta.url), 'utf8') });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const cdp = await page.context().newCDPSession(page);
  for (let serial = 0; serial < 4; serial++) {
    await page.evaluate(async serial => window.rendererMemoryChecks.disposeCase(serial % 2 === 1, serial), serial);
    // GC is diagnostic/test-only. Production code never forces collection or trims process memory.
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const retained = await page.evaluate(() => window.rendererMemoryChecks.retained());
    assert.deepEqual(retained, { timers: 0, terminals: 0, canvases: 0 }, `disposal ${serial}: no retained terminal or blink timer`);
  }
  await page.evaluate(() => window.rendererMemoryChecks.lifecycle());
  assert.deepEqual(errors, [], 'renderer transitions must not produce unhandled browser errors');
  console.log('Real-browser renderer retention, shell-forced blink, coalescing, focus, scrollback, context loss and closed-owner checks passed.');
} finally {
  await browser.close();
}
