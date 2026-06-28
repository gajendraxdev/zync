import assert from 'node:assert/strict';
import { needsTerminalRendererSetup } from '../.tmp-agent-tests/src/lib/terminal/rendererSetup.js';
import { createInitialRendererState } from '../.tmp-agent-tests/src/lib/terminal/types.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('fresh dom session with GPU on needs WebGL setup', () => {
  const state = createInitialRendererState();
  assert.equal(needsTerminalRendererSetup(state, true), true);
});

runTest('active WebGL session does not need setup', () => {
  const state = createInitialRendererState();
  state.kind = 'webgl';
  state.desiredKind = 'webgl';
  state.webglAddon = { dispose: () => {} };
  assert.equal(needsTerminalRendererSetup(state, true), false);
});

runTest('context-loss block skips further GPU setup', () => {
  const state = createInitialRendererState();
  state.webglContextLossBlocked = true;
  state.desiredKind = 'webgl';
  assert.equal(needsTerminalRendererSetup(state, true), false);
});

runTest('GPU off with WebGL loaded needs teardown setup', () => {
  const state = createInitialRendererState();
  state.kind = 'webgl';
  state.webglAddon = { dispose: () => {} };
  assert.equal(needsTerminalRendererSetup(state, false), true);
});

console.log('Terminal renderer setup tests passed.');