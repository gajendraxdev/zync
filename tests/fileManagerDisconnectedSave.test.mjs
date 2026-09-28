import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'FileManager.tsx'), 'utf8');
const connectionErrorHandler = source.match(/const handleConnectionError = useCallback\([\s\S]*?\}, \[instanceId\]\);/)?.[0];
const saveHandler = source.match(/const handleSaveFile = useCallback\([\s\S]*?\}, \[activeConnectionId, editingFile, editingFilePath, handleConnectionError, showToast\]\);/)?.[0];

assert.ok(connectionErrorHandler, 'connection error handler must exist');
assert.ok(saveHandler, 'file save handler must exist');
assert.match(connectionErrorHandler, /preserveEditor = false/, 'other connection errors must continue closing the editor');
assert.match(connectionErrorHandler, /if \(!preserveEditor\) setEditingFile\(null\)/, 'preserved editors must remain mounted');
assert.match(saveHandler, /handleConnectionError\(activeConnectionId, error, true\)/, 'a disconnected save must preserve unsaved content');
assert.match(saveHandler, /path: editingFilePath/, 'saving must target the path captured when the editor opened');
assert.match(saveHandler, /throw error;/, 'save failures must still reach the editor error handler');

console.log('File Manager disconnected save test passed.');
