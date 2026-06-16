import assert from 'node:assert/strict';
import {
  clearTerminalRendererSession,
  getTerminalRendererState,
  hasTerminalRendererSession,
} from '../.tmp-agent-tests/src/lib/terminal/rendererSession.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

const SESSION = 'test-renderer-session';

runTest('getTerminalRendererState creates and reuses session state', () => {
  clearTerminalRendererSession(SESSION);
  const first = getTerminalRendererState(SESSION);
  const second = getTerminalRendererState(SESSION);
  assert.equal(first, second);
  assert.equal(hasTerminalRendererSession(SESSION), true);
  clearTerminalRendererSession(SESSION);
});

runTest('clearTerminalRendererSession removes session ownership', () => {
  getTerminalRendererState(SESSION);
  clearTerminalRendererSession(SESSION);
  assert.equal(hasTerminalRendererSession(SESSION), false);
});

console.log('Terminal renderer session tests passed.');