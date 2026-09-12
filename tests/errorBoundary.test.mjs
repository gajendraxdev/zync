import assert from 'node:assert/strict';
import { isFailedLazyImport } from '../.tmp-agent-tests/src/components/errorBoundaryRetry.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('isFailedLazyImport detects dynamic import failures', () => {
  assert.equal(
    isFailedLazyImport(new Error('Failed to fetch dynamically imported module: /assets/FileManager.js')),
    true,
  );
  assert.equal(
    isFailedLazyImport(new Error('error loading dynamically imported module')),
    true,
  );
  assert.equal(
    isFailedLazyImport(new Error('Importing a module script failed.')),
    true,
  );
  assert.equal(
    isFailedLazyImport(new Error('Unable to preload CSS for /assets/FileManager.css')),
    true,
  );
});

runTest('isFailedLazyImport ignores ordinary render errors', () => {
  assert.equal(isFailedLazyImport(new Error('Invalid index specified: 23')), false);
  assert.equal(isFailedLazyImport(null), false);
});

console.log('ErrorBoundary tests passed.');
