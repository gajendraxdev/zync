import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PluginSaveState } from '../.tmp-agent-tests/src/components/editor/pluginSaveState.js';

const state = new PluginSaveState('saved');
assert.equal(state.change(undefined), true, 'contentless changes must not look clean');
assert.equal(state.providerDirtyChange(false), false, 'an explicit clean report wins');
assert.equal(state.change('edited'), true);
state.refreshIfClean('external');
assert.equal(state.savedContent, 'saved', 'dirty text must survive a host refresh');

state.reset('saved');
const unreportedSave = state.requestSave('edited');
assert.equal(state.dirty, true, 'a save request without emitChange still has unsaved text');
assert.equal(state.saveFailed(unreportedSave), true);
assert.equal(state.savedContent, 'saved');
assert.equal(state.saveSucceeded(unreportedSave, false), false);
assert.equal(state.savedContent, 'edited', 'success must use the submitted content');
assert.equal(state.change('later edit'), true, 'later edits compare with the saved baseline');

state.reset('saved');
const first = state.requestSave('first');
const second = state.requestSave('second');
assert.equal(state.saveSucceeded(first, false), true, 'an earlier queued save must not clear later edits');
assert.equal(state.saveSucceeded(second, false), false);

state.reset('saved');
const pending = state.requestSave('edited');
state.change(undefined);
assert.equal(state.saveSucceeded(pending, false), true, 'unknown edits after a request stay dirty');
assert.equal(state.providerDirtyChange(false), false);

state.reset('saved');
const acknowledged = state.requestSave('edited');
assert.equal(state.saveSucceeded(acknowledged, true), true, 'wait for the provider clean acknowledgement');
assert.equal(state.providerDirtyChange(false), false);

state.reset('saved');
assert.equal(state.saveFailed('submitted without change'), true,
  'failed content absent from emitChange must remain dirty');

const frame = fs.readFileSync(path.join(process.cwd(), 'src/components/EditorPluginFrame.tsx'), 'utf8');
assert.match(frame, /if \(!isSameDoc \|\| !saveStateRef\.current\.dirty\)/,
  'do not send update-document over dirty text');
assert.match(frame, /if \(docId === currentDocIdRef\.current\) \{\s*setSaveError\(message\);\s*setEditorDirty\(saveStateRef\.current\.saveFailed\(content\)\);/,
  'a stale failed save must not change the new document state');

console.log('Editor plugin save-state test passed.');
