import assert from 'node:assert/strict';
import {
  isPaneCloseBlocked,
  isPaneLayoutCloseBlocked,
  paneCloseScope,
  registerPaneCloseBlocker,
} from '../.tmp-agent-tests/src/lib/paneCloseBlockers.js';

const files = { kind: 'feature', featureId: 'files', instanceId: 'files-one' };
const scope = paneCloseScope('server-one', files);
assert.equal(scope, paneCloseScope('server-one', files));
assert.notEqual(scope, paneCloseScope('server-two', files));
assert.notEqual(scope, paneCloseScope('server-one', { ...files, instanceId: 'files-two' }));
assert.equal(paneCloseScope('server-one', { kind: 'term', termId: 'shell' }), null);

const first = {};
const second = {};
const clearFirst = registerPaneCloseBlocker(scope, first);
const clearSecond = registerPaneCloseBlocker(scope, second);
assert.equal(isPaneCloseBlocked(scope), true);
assert.equal(isPaneLayoutCloseBlocked('server-one', {
  root: { type: 'pane', id: 'pane-one', content: files },
}), true);
assert.equal(isPaneLayoutCloseBlocked('server-two', {
  root: { type: 'pane', id: 'pane-one', content: files },
}), false);
const shell = { kind: 'term', termId: 'shell' };
const splitLayout = {
  root: {
    type: 'split', id: 'split-one', direction: 'horizontal', sizes: [0.5, 0.5],
    children: [
      { type: 'pane', id: 'pane-one', content: files },
      { type: 'pane', id: 'pane-two', content: shell },
    ],
  },
};
assert.equal(isPaneLayoutCloseBlocked('server-one', splitLayout), true,
  'the group remains blocked by an unsaved editor');
assert.equal(isPaneCloseBlocked(paneCloseScope('server-one', shell)), false,
  'an unrelated terminal pane can still be closed');
assert.equal(isPaneCloseBlocked(paneCloseScope('server-one', files)), true,
  'the dirty Files pane itself remains blocked');
clearFirst();
assert.equal(isPaneCloseBlocked(scope), true, 'another dirty editor still blocks closing');
clearSecond();
assert.equal(isPaneCloseBlocked(scope), false);
assert.equal(isPaneCloseBlocked(null), false);

console.log('Pane close blocker test passed.');
