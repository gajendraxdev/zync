import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  parseEditorStatusReport,
  plainCursorPosition,
} from '../.tmp-agent-tests/src/components/editor/editorStatusReport.js';

const current = 'file-editor:current';
assert.deepEqual(parseEditorStatusReport({ docId: current, line: 2, column: 4, language: 'C++' }, current), {
  docId: current, line: 2, column: 4, language: 'C++',
});
for (const payload of [
  { docId: 'old', line: 1, column: 1 },
  { docId: current, line: 0, column: 1 },
  { docId: current, line: 1.5, column: 1 },
  { docId: current, line: 1, column: Infinity },
  { docId: current, line: 1, column: 10_000_001 },
  { docId: current, line: 1, column: 1, language: '/private/path' },
  { docId: current, line: 1, column: 1, language: 'x'.repeat(33) },
]) assert.equal(parseEditorStatusReport(payload, current), null);

assert.deepEqual(plainCursorPosition('alpha\nbeta', 0), { line: 1, column: 1 });
assert.deepEqual(plainCursorPosition('alpha\nbeta', 6), { line: 2, column: 1 });
assert.deepEqual(plainCursorPosition('alpha\nbeta', 10), { line: 2, column: 5 });

const frame = fs.readFileSync('src/components/EditorPluginFrame.tsx', 'utf8');
assert.match(frame, /reportStatus\(status\)[\s\S]*?zync:editor:status/);
assert.match(frame, /parseEditorStatusReport\(payload, currentDocIdRef\.current\)/);
assert.match(frame, /clearEditorStatus\(statusSourceRef\.current\)/);
const bundledEditor = fs.readFileSync('src-tauri/src/plugins/builtins/editors.rs', 'utf8');
assert.match(bundledEditor, /reportStatus\(\{[\s\S]*?docId: currentDoc\.docId,[\s\S]*?line,[\s\S]*?column:/,
  'the bundled editor must publish the active document cursor');

console.log('Editor status report test passed.');
