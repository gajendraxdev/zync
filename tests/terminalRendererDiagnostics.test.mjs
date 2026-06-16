import assert from 'node:assert/strict';
import { describeTerminalRendererState } from '../.tmp-agent-tests/src/lib/terminal/rendererDiagnostics.js';
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

runTest('reports gpu-active when WebGL renderer is active', () => {
  const state = createInitialRendererState();
  state.kind = 'webgl';
  state.desiredKind = 'webgl';
  const result = describeTerminalRendererState(state, { gpuAcceleration: true });
  assert.equal(result.health, 'gpu-active');
  assert.equal(result.summary, 'GPU acceleration is active');
});

runTest('reports canvas-expected when GPU is disabled in settings', () => {
  const state = createInitialRendererState();
  const result = describeTerminalRendererState(state, { gpuAcceleration: false });
  assert.equal(result.health, 'canvas-expected');
  assert.match(result.summary, /GPU off/);
});

runTest('reports canvas-fallback with context-loss detail', () => {
  const state = createInitialRendererState();
  state.webglContextLossBlocked = true;
  state.desiredKind = 'webgl';
  const result = describeTerminalRendererState(state, { gpuAcceleration: true });
  assert.equal(result.health, 'canvas-fallback');
  assert.match(result.detail ?? '', /context was lost/i);
});

console.log('Terminal renderer diagnostics tests passed.');