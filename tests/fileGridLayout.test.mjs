import assert from 'node:assert/strict';
import {
  computeFileGridMetrics,
  fileGridScrollTarget,
  formatFileIdentity,
  formatFileListDate,
  fileListSortTooltip,
  FILE_LIST_COLUMNS,
  FILE_LIST_SORT_INITIAL,
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

function entry(name, type = '-', size = 0, lastModified = 0, owner = '', group = '') {
  return { name, type, size, lastModified, permissions: '', path: `/${name}`, owner, group };
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
  assert.equal(m.gap, 6);
  assert.equal(m.columnCount, 3);
  assert.ok(m.columnWidth > 100);
  assert.ok(Math.abs(m.columnWidth * m.columnCount - 332) < 0.001);
});

runTest('fileGridScrollTarget rejects a cell past the live grid', () => {
  assert.equal(fileGridScrollTarget(23, 8, 2), null);
  assert.deepEqual(fileGridScrollTarget(23, 8, 4), { rowIndex: 2, columnIndex: 7 });
  assert.equal(fileGridScrollTarget(-1, 8, 4), null);
  assert.equal(fileGridScrollTarget(0, 8, 0), null);
});

runTest('FILE_LIST_COLUMNS includes name flex track and size column', () => {
  assert.equal(FILE_LIST_COLUMNS.includes('minmax(0, 1fr)'), true);
  assert.equal(FILE_LIST_COLUMNS.includes('minmax(0, 5.25rem)'), true);
});

runTest('formatFileListDate uses time today and short date otherwise', () => {
  const now = Date.parse('2026-09-10T15:00:00');
  assert.ok(formatFileListDate(Date.parse('2026-09-10T08:32:00'), now).length > 0);
  const thisYear = formatFileListDate(Date.parse('2026-03-19T12:00:00'), now);
  assert.ok(thisYear.length > 0);
  assert.equal(thisYear.includes('2026'), false);
  assert.equal(formatFileListDate(Date.parse('2025-11-20T12:00:00'), now).includes('2025'), true);
  assert.equal(formatFileListDate(0, now), '');
});

runTest('formatFileIdentity joins owner:group', () => {
  assert.equal(formatFileIdentity('admin', 'admin'), 'admin:admin');
  assert.equal(formatFileIdentity('root', 'staff'), 'root:staff');
  assert.equal(formatFileIdentity('', ''), '');
  assert.equal(formatFileIdentity('root', ''), 'root');
});

runTest('fileListSortTooltip explains current and next sort', () => {
  assert.equal(FILE_LIST_SORT_INITIAL.size, 'desc');
  assert.equal(FILE_LIST_SORT_INITIAL.modified, 'desc');
  assert.ok(fileListSortTooltip('name', 'name', 'asc').includes('A to Z'));
  assert.ok(fileListSortTooltip('name', 'name', 'asc').includes('Z to A'));
  assert.ok(fileListSortTooltip('modified', 'name', 'asc').includes('newest first'));
});

runTest('sortFileEntries compares combined owner:group', () => {
  const byOwner = sortFileEntries(
    [entry('b.txt', '-', 0, 0, 'root', 'root'), entry('a.txt', '-', 0, 0, 'alice', 'alice')],
    'owner',
    'asc',
  );
  assert.deepEqual(byOwner.map((f) => f.name), ['a.txt', 'b.txt']);
});

console.log('fileGridLayout tests passed.');
