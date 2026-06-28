import assert from 'node:assert/strict';
import {
  resolveDesiredTerminalRenderer,
  rendererKindLabel,
} from '../.tmp-agent-tests/src/lib/terminal/rendererPolicy.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('prefers WebGL when GPU acceleration is enabled', () => {
  assert.equal(
    resolveDesiredTerminalRenderer({ gpuAcceleration: true }),
    'webgl',
  );
});

runTest('forces dom when GPU acceleration is disabled', () => {
  assert.equal(
    resolveDesiredTerminalRenderer({ gpuAcceleration: false }),
    'dom',
  );
});

runTest('forces dom when WebGL context loss blocked the session', () => {
  assert.equal(
    resolveDesiredTerminalRenderer({
      gpuAcceleration: true,
      webglContextLossBlocked: true,
    }),
    'dom',
  );
});

runTest('rendererKindLabel maps kinds to user-facing labels', () => {
  assert.equal(rendererKindLabel('webgl'), 'GPU (WebGL)');
  assert.equal(rendererKindLabel('dom'), 'DOM');
});

console.log('Terminal renderer policy tests passed.');