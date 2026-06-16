import assert from 'node:assert/strict';
import {
  getWebgl2AvailabilityCacheForTests,
  isWebgl2Available,
  resetWebgl2AvailabilityCache,
} from '../.tmp-agent-tests/src/lib/terminal/webglCapability.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('isWebgl2Available returns false when document is unavailable', () => {
  resetWebgl2AvailabilityCache();
  assert.equal(isWebgl2Available(), false);
});

runTest('resetWebgl2AvailabilityCache clears cache and allows re-probing', () => {
  resetWebgl2AvailabilityCache();
  assert.equal(getWebgl2AvailabilityCacheForTests(), null);

  const first = isWebgl2Available();
  assert.equal(first, false);
  assert.equal(getWebgl2AvailabilityCacheForTests(), false);

  resetWebgl2AvailabilityCache();
  assert.equal(getWebgl2AvailabilityCacheForTests(), null);

  const second = isWebgl2Available();
  assert.equal(second, false);
  assert.equal(getWebgl2AvailabilityCacheForTests(), false);
});

console.log('Terminal WebGL capability tests passed.');