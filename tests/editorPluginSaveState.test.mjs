import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { PluginSaveState } from '../.tmp-agent-tests/src/components/editor/pluginSaveState.js';

const state = new PluginSaveState('saved');
assert.equal(state.change(undefined), true, 'contentless changes must not look clean');
assert.equal(state.providerDirtyChange(false), true, 'a clean report cannot clear unknown edits');
assert.equal(state.change('edited'), true);
assert.equal(state.providerDirtyChange(false), true, 'a clean report cannot clear content that differs from the saved baseline');
state.refreshIfClean('external');
assert.equal(state.savedContent, 'saved', 'dirty text must survive a host refresh');
assert.equal(state.change('saved'), false, 'a matching content snapshot restores the clean state');

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
assert.equal(state.providerDirtyChange(false), true, 'a clean report cannot clear unknown edits after a save');

state.reset('saved');
const prematureClean = state.requestSave('edited');
assert.equal(state.providerDirtyChange(false), true, 'an optimistic clean report must not preempt the host write');
assert.equal(state.saveSucceeded(prematureClean, false), false, 'a successful host write updates the saved baseline');

state.reset('saved');
const failedAfterClean = state.requestSave('edited');
assert.equal(state.providerDirtyChange(false), true);
assert.equal(state.saveFailed(failedAfterClean), true,
  'a failed write remains dirty even after a provider clean report');

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
assert.match(frame, /frameGeneration === frameGenerationRef\.current &&\s*docId === currentDocIdRef\.current\s*\) \{\s*setSaveError\(message\);\s*setEditorDirty\(saveStateRef\.current\.saveFailed\(content\)\);/,
  'a stale failed save must not change the new document state');
assert.match(frame, /type: 'zync:editor:command'/,
  'the shared toolbar must send commands through the editor protocol');
assert.doesNotMatch(frame, /showToast\('success'/,
  'successful plugin saves use inline state instead of a redundant toast');
assert.match(frame, /markSavePending\(frameGeneration, docId\);[\s\S]*?saveQueueRef\.current\.then\(save, save\)/,
  'a save must become pending before it is added to the async queue');
assert.match(frame, /frameGenerationRef\.current \+= 1;[\s\S]*?pendingSaveCountsRef\.current\.clear\(\);[\s\S]*?setIsSaving\(false\);/,
  'an iframe reload must clear pending save UI state');
assert.match(frame, /frameGeneration === frameGenerationRef\.current[\s\S]*?finishSavePending\(frameGeneration, docId\)/,
  'save completion must be scoped to the iframe generation that started it');

const toolbar = fs.readFileSync(path.join(
  process.cwd(), 'src/components/editor/PluginEditorToolbar.tsx',
), 'utf8');
for (const label of ['Shortcuts', 'Saved', 'Go to Line', 'Find / Replace']) {
  assert.match(toolbar, new RegExp(label.replace('/', '\\/')),
    `the shared plugin toolbar must expose ${label}`);
}

const builtin = fs.readFileSync(path.join(process.cwd(), 'src-tauri/src/plugins/builtins/editors.rs'), 'utf8');
assert.match(builtin, /requestSave\(editor\.value, \{ docId: currentDoc\.docId, requestId \}\)/,
  'the bundled provider must request an acknowledged save');
assert.match(builtin, /if \(type === 'zync:editor:save-result'[\s\S]*?if \(payload\.ok\) initialContent = submittedContent;/,
  'the bundled provider must update its baseline only after a successful write');
assert.doesNotMatch(builtin, /requestSave\(editor\.value[^\n]*\);\s*initialContent = editor\.value;/,
  'requesting a save must not optimistically mark content saved');

console.log('Editor plugin save-state test passed.');
