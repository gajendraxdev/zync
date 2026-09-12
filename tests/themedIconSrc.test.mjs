import assert from 'node:assert/strict';
import { fileTypeIconID, themedIconKey } from '../.tmp-agent-tests/src/lib/icons/themedIconSrc.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('themedIconKey is unique per theme, plugin, and icon id', () => {
  const a = themedIconKey('vscode-icons', 'file_type_typescript', '');
  const b = themedIconKey('vscode-icons', 'file_type_javascript', '');
  const c = themedIconKey('lucide', 'file_type_typescript', '');
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.equal(a, themedIconKey('vscode-icons', 'file_type_typescript', ''));
  assert.notEqual(
    themedIconKey('pack', 'file_type_ts', 'pack', '/old', 'icons'),
    themedIconKey('pack', 'file_type_ts', 'pack', '/new', 'icons'),
  );
});

runTest('fileTypeIconID maps many files of the same extension to one id', () => {
  const a = fileTypeIconID('app.ts', false, 'vscode-icons');
  const b = fileTypeIconID('store.ts', false, 'vscode-icons');
  const c = fileTypeIconID('app.js', false, 'vscode-icons');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(fileTypeIconID('src', true, 'vscode-icons'), 'folder_type_src');
});

console.log('themedIconSrc tests passed.');
