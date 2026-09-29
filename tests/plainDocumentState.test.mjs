import assert from 'node:assert/strict';
import {
  markPlainDocumentSaved,
  reconcilePlainDocument,
} from '../.tmp-agent-tests/src/components/editor/plainDocumentState.js';

let state = { documentId: 'one', content: 'original', savedContent: 'original' };
state = { ...state, content: 'first edit' };
state = { ...state, content: 'second edit' };
state = markPlainDocumentSaved(state, 'one', 'first edit');
state = reconcilePlainDocument(state, 'one', 'first edit');
assert.equal(state.content, 'second edit', 'edits typed during a save must survive its completion');
assert.equal(state.savedContent, 'first edit');

state = reconcilePlainDocument(state, 'one', 'external refresh');
assert.equal(state.content, 'second edit', 'a refresh must not overwrite unsaved edits');
assert.equal(state.savedContent, 'external refresh');

state = { ...state, content: 'external refresh' };
state = reconcilePlainDocument(state, 'one', 'new refresh');
assert.equal(state.content, 'new refresh', 'a clean editor follows incoming content');

state = reconcilePlainDocument(state, 'two', 'other file');
assert.deepEqual(state, { documentId: 'two', content: 'other file', savedContent: 'other file' });
assert.equal(markPlainDocumentSaved(state, 'one', 'stale save'), state,
  'a completed save from an older document must not modify the new document');

console.log('Plain editor document state test passed.');
