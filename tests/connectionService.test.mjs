import assert from 'node:assert/strict';
import {
  deleteFolderFromState,
  renameFolderInState,
  upsertConnectionInState,
  updateConnectionFolderInState,
} from '../.tmp-agent-tests/src/features/connections/application/connectionService.js';

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await runTest('deleteFolderFromState removes subtree folders and ungroups connections', () => {
  const state = {
    folders: [{ name: 'prod' }, { name: 'prod/api' }, { name: 'qa' }],
    connections: [
      { id: '1', folder: 'prod' },
      { id: '2', folder: 'prod/api' },
      { id: '3', folder: 'qa' },
    ],
  };

  const next = deleteFolderFromState(state, 'prod');
  assert.deepEqual(next.folders.map((f) => f.name), ['qa']);
  assert.equal(next.connections.find((c) => c.id === '1')?.folder, '');
  assert.equal(next.connections.find((c) => c.id === '2')?.folder, '');
  assert.equal(next.connections.find((c) => c.id === '3')?.folder, 'qa');
});

await runTest('renameFolderInState remaps subtree folders and connections', () => {
  const state = {
    folders: [{ name: 'prod', tags: ['x'] }, { name: 'prod/api' }],
    connections: [{ id: '1', folder: 'prod' }, { id: '2', folder: 'prod/api' }],
  };

  const next = renameFolderInState(state, 'prod', 'production', ['new']);
  assert.deepEqual(next.folders.map((f) => f.name), ['production', 'production/api']);
  assert.deepEqual(next.connections.map((c) => c.folder), ['production', 'production/api']);
  assert.deepEqual(next.folders.find((f) => f.name === 'production')?.tags, ['new']);
});

await runTest('updateConnectionFolderInState normalizes folder path', () => {
  const state = { folders: [], connections: [{ id: '1', folder: '' }] };
  const next = updateConnectionFolderInState(state, '1', ' prod / api ');
  assert.equal(next.connections[0].folder, 'prod/api');
  assert.deepEqual(next.folders.map((f) => f.name), ['prod/api']);
});

await runTest('upsertConnectionInState persists implicit folder from edited or added connection', () => {
  const state = { folders: [], connections: [] };
  const next = upsertConnectionInState(state, { id: '1', folder: 'team/backend', host: 'h', username: 'u', port: 22, name: 'n', status: 'disconnected' });
  assert.equal(next.connections.length, 1);
  assert.deepEqual(next.folders.map((f) => f.name), ['team/backend']);
});

console.log('Connection service tests passed.');
