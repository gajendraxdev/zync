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

runTest('forces canvas when GPU acceleration is disabled', () => {
  assert.equal(
    resolveDesiredTerminalRenderer({ gpuAcceleration: false }),
    'canvas',
  );
});

runTest('forces canvas when WebGL context loss blocked the session', () => {
  assert.equal(
    resolveDesiredTerminalRenderer({
      gpuAcceleration: true,
      webglContextLossBlocked: true,
    }),
    'canvas',
  );
});

runTest('rendererKindLabel maps kinds to user-facing labels', () => {
  assert.equal(rendererKindLabel('webgl'), 'GPU (WebGL)');
  assert.equal(rendererKindLabel('canvas'), 'Canvas');
});

console.log('Terminal renderer policy tests passed.');