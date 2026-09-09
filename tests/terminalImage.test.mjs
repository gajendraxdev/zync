import assert from 'node:assert/strict';
import {
  buildTerminalImageAddonOptions,
  disposeTerminalImageAddon,
  loadTerminalImageAddon,
  rebuildTerminalImageLayer,
  TERMINAL_IMAGE_STORAGE_LIMIT_MB,
} from '../.tmp-agent-tests/src/lib/terminal/terminalImage.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('buildTerminalImageAddonOptions enables sixel, IIP, and size reports', () => {
  const options = buildTerminalImageAddonOptions();
  assert.equal(options.enableSizeReports, true);
  assert.equal(options.sixelSupport, true);
  assert.equal(options.sixelScrolling, true);
  assert.equal(options.iipSupport, true);
  assert.equal(options.showPlaceholder, true);
  assert.equal(options.storageLimit, TERMINAL_IMAGE_STORAGE_LIMIT_MB);
  assert.ok(options.storageLimit < 128);
});

runTest('loadTerminalImageAddon loads the created addon', () => {
  const loaded = [];
  const addon = { dispose() {} };
  const result = loadTerminalImageAddon(
    { loadAddon(next) { loaded.push(next); } },
    () => addon,
  );
  assert.equal(result, addon);
  assert.deepEqual(loaded, [addon]);
});

runTest('loadTerminalImageAddon returns undefined when loadAddon throws', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => { warnings.push(args); };
  try {
    const result = loadTerminalImageAddon(
      { loadAddon() { throw new Error('no proposed api'); } },
      () => ({ dispose() {} }),
    );
    assert.equal(result, undefined);
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

runTest('disposeTerminalImageAddon clears the cache field', () => {
  let disposed = 0;
  const cached = { imageAddon: { dispose() { disposed += 1; } } };
  disposeTerminalImageAddon(cached);
  assert.equal(disposed, 1);
  assert.equal(cached.imageAddon, undefined);
  disposeTerminalImageAddon(cached);
  assert.equal(disposed, 1);
});

runTest('rebuildTerminalImageLayer is a no-op without a live overlay', () => {
  let refreshed = 0;
  rebuildTerminalImageLayer({ rows: 24, refresh() { refreshed += 1; } });
  rebuildTerminalImageLayer(
    { rows: 24, refresh() { refreshed += 1; } },
    { _renderer: { removeLayerFromDom() { refreshed += 1; } } },
  );
  assert.equal(refreshed, 0);
});

runTest('rebuildTerminalImageLayer drops the overlay and refreshes', () => {
  let removed = 0;
  let refreshed = 0;
  rebuildTerminalImageLayer(
    {
      rows: 24,
      refresh(start, end) {
        refreshed += 1;
        assert.equal(start, 0);
        assert.equal(end, 23);
      },
    },
    {
      _renderer: {
        canvas: {},
        removeLayerFromDom() { removed += 1; },
      },
    },
  );
  assert.equal(removed, 1);
  assert.equal(refreshed, 1);
});

runTest('disposeTerminalImageAddon swallows dispose errors', () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const cached = { imageAddon: { dispose() { throw new Error('already gone'); } } };
    disposeTerminalImageAddon(cached);
    assert.equal(cached.imageAddon, undefined);
  } finally {
    console.warn = originalWarn;
  }
});

console.log('Terminal image addon tests passed.');
