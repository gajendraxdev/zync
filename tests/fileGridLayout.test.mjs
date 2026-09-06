import assert from 'node:assert/strict';
import {
  computeFileGridMetrics,
  FILE_LIST_COLUMNS,
  fileGridKeyboardIndex,
  sortFileEntries,
} from '../.tmp-agent-tests/src/components/file-manager/fileGridLayout.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

function entry(name, type = '-', size = 0, lastModified = 0) {
  return { name, type, size, lastModified, permissions: '', path: `/${name}` };
}

runTest('sortFileEntries puts directories first then name', () => {
  const sorted = sortFileEntries(
    [entry('b.txt'), entry('a', 'd'), entry('c.txt')],
    'name',
    'asc',
  );
  assert.deepEqual(sorted.map((f) => f.name), ['a', 'b.txt', 'c.txt']);
});

runTest('sortFileEntries reverses non-dir comparison on desc', () => {
  const sorted = sortFileEntries(
    [entry('b.txt', '-', 2), entry('a.txt', '-', 1)],
    'size',
    'desc',
  );
  assert.deepEqual(sorted.map((f) => f.name), ['b.txt', 'a.txt']);
});

runTest('computeFileGridMetrics compact column count', () => {
  const m = computeFileGridMetrics(332, true);
  assert.equal(m.gap, 8);
  assert.equal(m.columnCount, 3);
  assert.ok(m.columnWidth > 100);
});

runTest('fileGridKeyboardIndex is row-major', () => {
  assert.equal(fileGridKeyboardIndex(1, 2, 4), 6);
});

runTest('FILE_LIST_COLUMNS includes name flex track and size column', () => {
  assert.equal(FILE_LIST_COLUMNS.includes('minmax(0, 1fr)'), true);
  assert.equal(FILE_LIST_COLUMNS.includes('6rem'), true);
});

console.log('fileGridLayout tests passed.');
