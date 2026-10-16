import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileSelectionSummary } from '../.tmp-agent-tests/src/components/file-manager/fileSelectionSummary.js';
import { FileSelectionMark } from '../.tmp-agent-tests/src/components/file-manager/FileSelectionMark.js';

const file = (name, size, type = '-') => ({ name, size, type });

test('selection summary totals only loaded regular files, not folders or link targets', () => {
  const entries = [file('a.txt', 1024), file('empty', 0), file('folder', 4096, 'd'), file('link', 8192, 'l')];
  assert.deepEqual(fileSelectionSummary(entries, entries.map(entry => entry.name)), {
    count: 4, files: 2, folders: 1, links: 1, bytes: 1024, unknownSizes: 0,
  });
  assert.deepEqual(fileSelectionSummary(entries, ['folder']), {
    count: 1, files: 0, folders: 1, links: 0, bytes: 0, unknownSizes: 0,
  });
});

test('selection summary retains hidden selections, ignores vanished/duplicate names and never mutates its inputs', () => {
  const entries = Object.freeze([Object.freeze(file('.hidden', 256)), Object.freeze(file('a.txt', 1024))]);
  const names = Object.freeze(['.hidden', '.hidden', 'gone']);
  assert.deepEqual(fileSelectionSummary(entries, names), { count: 1, files: 1, folders: 0, links: 0, bytes: 256, unknownSizes: 0 });
  assert.equal(fileSelectionSummary(entries, []).count, 0);
  assert.equal(names.length, 3);
});

test('invalid or unsafe file sizes stay explicitly unknown instead of poisoning the total', () => {
  const entries = [file('valid', 100), file('negative', -1), file('nan', NaN), file('infinite', Infinity), file('overflow', Number.MAX_SAFE_INTEGER)];
  const result = fileSelectionSummary(entries, entries.map(entry => entry.name));
  assert.equal(result.count, 5);
  assert.equal(result.bytes, 100);
  assert.equal(result.unknownSizes, 4);
});

test('selection mark is shared visual feedback, never a second interactive control inside an option', () => {
  for (const selected of [false, true]) {
    const html = renderToStaticMarkup(createElement(FileSelectionMark, { selected }));
    assert.match(html, /data-file-select="" aria-hidden="true"/);
    assert.match(html, /files-selection-box/);
    assert.equal(html.includes('<svg'), selected);
    assert.doesNotMatch(html, /<input|<button|tabindex=|role="checkbox"/);
  }
});
