import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import * as defaults from '../.tmp-agent-tests/src/components/settings/constants/defaults.js';
import * as policy from '../.tmp-agent-tests/src/lib/terminal/terminalIdlePtyPolicy.js';

const defaultsUrl = new URL('../.tmp-agent-tests/src/components/settings/constants/defaults.js', import.meta.url);
const policyUrl = new URL('../.tmp-agent-tests/src/lib/terminal/terminalIdlePtyPolicy.js', import.meta.url);

/** Inspect emitted imports, including re-exports, after type-only dependencies are removed. */
function runtimeImports(url) {
  return ts.preProcessFile(readFileSync(url, 'utf8'), true, true).importedFiles
    .map(({ fileName }) => new URL(fileName, url).href);
}

test('importing typography defaults cannot initialize the store or PTY lifecycle', () => {
  // Exercise the real ES modules first, then enforce their complete dependency boundary.
  assert.equal(defaults.DEFAULT_SUSPEND_IDLE_HOST_PTYS, false);
  assert.equal(defaults.DEFAULT_IDLE_HOST_PTY_SUSPEND_MINUTES, 2);
  const typography = defaults.resolveDefaultTerminalTypography();
  assert.ok([
    defaults.DEFAULT_TERMINAL_FONT_STACK,
    defaults.DEFAULT_TERMINAL_FONT_STACK_WIN32,
  ].includes(typography.fontFamily), 'Defaults remain valid with or without the terminal test browser shim');
  assert.deepEqual(runtimeImports(defaultsUrl), [policyUrl.href]);
  assert.deepEqual(runtimeImports(policyUrl), []);
});

test('idle policy preserves defaults, timeout bounds and retry delay', () => {
  assert.equal(policy.DEFAULT_SUSPEND_IDLE_HOST_PTYS, false);
  assert.equal(policy.DEFAULT_IDLE_HOST_PTY_SUSPEND_MINUTES, 2);
  assert.equal(policy.DEFAULT_IDLE_PTY_SUSPEND_MS, 120_000);
  assert.equal(policy.DEFAULT_IDLE_PTY_SUSPEND_MS, policy.DEFAULT_IDLE_HOST_PTY_SUSPEND_MINUTES * 60_000);
  assert.equal(policy.MIN_IDLE_HOST_PTY_SUSPEND_MINUTES, 1);
  assert.equal(policy.MAX_IDLE_HOST_PTY_SUSPEND_MINUTES, 60);
  assert.equal(policy.MIN_IDLE_SUSPEND_BUSY_RETRY_MS, 1_000);
});

test('normalization retains fallback, rounding and clamping behavior', () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity]) {
    assert.equal(policy.normalizeIdleHostPtySuspendMinutes(value), 2);
  }
  for (const [value, expected] of [[-10, 1], [0, 1], [1.4, 1], [1.5, 2], [12.6, 13], [60, 60], [100, 60]]) {
    assert.equal(policy.normalizeIdleHostPtySuspendMinutes(value), expected);
  }
});

test('disabled policy returns no delay and enabled policy uses normalized minutes', () => {
  for (const value of [undefined, NaN, -1, 5, 100]) {
    assert.equal(policy.resolveIdleHostPtySuspendDelayMs(false, value), null);
  }
  for (const [value, expected] of [[undefined, 120_000], [NaN, 120_000], [-1, 60_000], [2.5, 180_000], [100, 3_600_000]]) {
    assert.equal(policy.resolveIdleHostPtySuspendDelayMs(true, value), expected);
  }
});

test('runtime module preserves its existing policy exports', async () => {
  const runtime = await import('../.tmp-agent-tests/src/lib/terminal/terminalIdlePty.js');
  for (const [name, value] of Object.entries(policy)) {
    assert.equal(runtime[name], value, `${name} remains available to existing runtime consumers`);
  }
});
