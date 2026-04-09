import assert from 'node:assert/strict';
import {
  activateExistingConnectionTab,
  createConnectionTabState,
  createLocalTerminalTabState,
  ensureGlobalSnippetsTab,
  ensureSingleTabByType,
  findConnectionTab,
} from '../.tmp-agent-tests/src/features/connections/application/tabService.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest('createLocalTerminalTabState appends local tab and activates it', () => {
  const state = createLocalTerminalTabState([]);
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].connectionId, 'local');
  assert.equal(state.activeConnectionId, 'local');
  assert.equal(state.activeTabId, state.tabs[0].id);
});

runTest('findConnectionTab returns connection tab only', () => {
  const tabs = [
    { id: '1', type: 'settings', title: 'Settings' },
    { id: '2', type: 'connection', title: 'Web', connectionId: 'c1', view: 'terminal' },
  ];
  const result = findConnectionTab(tabs, 'c1');
  assert.equal(result?.id, '2');
});

runTest('activateExistingConnectionTab updates view and active pointers', () => {
  const tabs = [{ id: '2', type: 'connection', title: 'Web', connectionId: 'c1', view: 'terminal' }];
  const state = activateExistingConnectionTab(tabs, tabs[0], 'files', 'c1');
  assert.equal(state.tabs[0].view, 'files');
  assert.equal(state.activeConnectionId, 'c1');
  assert.equal(state.activeTabId, '2');
});

runTest('createConnectionTabState appends and activates new connection tab', () => {
  const state = createConnectionTabState([], { id: 'c2', name: 'DB', host: '10.0.0.2' }, 'terminal');
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].connectionId, 'c2');
  assert.equal(state.tabs[0].title, 'DB');
});

runTest('ensureSingleTabByType returns existing tab activation', () => {
  const tabs = [{ id: 'pf1', type: 'port-forwarding', title: 'PF', view: 'port-forwarding' }];
  const state = ensureSingleTabByType(tabs, 'port-forwarding', () => ({
    id: 'new',
    type: 'port-forwarding',
    title: 'PF',
    view: 'port-forwarding',
  }));
  assert.equal(state.activeTabId, 'pf1');
  assert.equal(state.tabs, undefined);
});

runTest('ensureGlobalSnippetsTab creates local snippets tab if absent', () => {
  const state = ensureGlobalSnippetsTab([]);
  assert.equal(state.tabs?.length, 1);
  assert.equal(state.tabs?.[0].connectionId, 'local');
  assert.equal(state.tabs?.[0].view, 'snippets');
  assert.equal(state.activeConnectionId, 'local');
});

console.log('Connection tab service tests passed.');
