import assert from 'node:assert/strict';
import {
  addFolderExact,
  deleteFolderExact,
  renameConnectionFolderExact,
  renameFolderExact,
  updateConnectionFolderExact,
  remapFolderPath,
  isFolderOrDescendant,
} from '../.tmp-agent-tests/src/features/connections/domain/folderTreeOps.js';
import {
  mergeImportedConnectionsByName,
} from '../.tmp-agent-tests/src/features/connections/domain/merge.js';
import {
  buildConnectConfig,
} from '../.tmp-agent-tests/src/features/connections/domain/connectionConfig.js';
import {
  hasRequiredHostAndUsername,
} from '../.tmp-agent-tests/src/features/connections/domain/validation.js';
import {
  normalizeFolderPath,
  normalizePort,
  normalizeTags,
} from '../.tmp-agent-tests/src/features/connections/domain/normalization.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest('normalize helpers keep expected defaults', () => {
  assert.equal(normalizePort('abc'), 22);
  assert.equal(normalizePort(2222), 2222);
  assert.equal(normalizeFolderPath(' prod / web // '), 'prod/web');
  assert.deepEqual(normalizeTags(['a', ' a ', '', 'b']), ['a', 'b']);
});

runTest('required-field helper checks trimmed host and username', () => {
  assert.equal(hasRequiredHostAndUsername({ host: ' 1.1.1.1 ', username: ' root ' }), true);
  assert.equal(hasRequiredHostAndUsername({ host: '  ', username: 'root' }), false);
  assert.equal(hasRequiredHostAndUsername({ host: '1.1.1.1', username: '' }), false);
});

runTest('folder exact helpers preserve current exact-match semantics', () => {
  const folders = [{ name: 'prod' }, { name: 'staging', tags: ['blue'] }];
  assert.equal(addFolderExact(folders, 'prod'), folders);
  assert.deepEqual(deleteFolderExact(folders, 'prod'), [{ name: 'staging', tags: ['blue'] }]);
  assert.deepEqual(renameFolderExact(folders, 'staging', 'qa'), [{ name: 'prod' }, { name: 'qa', tags: ['blue'] }]);
});

runTest('connection folder exact helpers update only targeted rows', () => {
  const connections = [
    { id: '1', folder: 'prod' },
    { id: '2', folder: 'staging' },
  ];
  assert.deepEqual(updateConnectionFolderExact(connections, '2', 'prod'), [
    { id: '1', folder: 'prod' },
    { id: '2', folder: 'prod' },
  ]);
  assert.deepEqual(renameConnectionFolderExact(connections, 'prod', 'qa'), [
    { id: '1', folder: 'qa' },
    { id: '2', folder: 'staging' },
  ]);
});

runTest('tree helpers support subtree checks and remap', () => {
  assert.equal(isFolderOrDescendant('prod', 'prod/web'), true);
  assert.equal(isFolderOrDescendant('prod', 'stage/web'), false);
  assert.equal(remapFolderPath('prod/web/api', 'prod', 'production'), 'production/web/api');
});

runTest('import merge keeps existing ids for same names and dedups by id', () => {
  const existing = [
    { id: 'a', name: 'web', status: 'connected' },
    { id: 'b', name: 'db', status: 'disconnected' },
  ];
  const incoming = [
    { id: 'x', name: 'web', status: 'disconnected' },
    { id: 'y', name: 'cache', status: 'disconnected' },
  ];

  const result = mergeImportedConnectionsByName(existing, incoming);
  assert.equal(result.updated, 1);
  assert.equal(result.created, 1);

  const web = result.merged.find((c) => c.name === 'web');
  const cache = result.merged.find((c) => c.name === 'cache');
  assert.equal(web?.id, 'a');
  assert.equal(web?.status, 'connected');
  assert.equal(cache?.id, 'y');
});

runTest('buildConnectConfig builds jump-host chain and rejects simple cycle', () => {
  const connections = [
    { id: 'a', name: 'A', host: 'a', port: 22, username: 'u', password: 'p', status: 'disconnected', jumpServerId: 'b' },
    { id: 'b', name: 'B', host: 'b', port: 22, username: 'u', password: 'p', status: 'disconnected' },
  ];

  const config = buildConnectConfig(connections, 'a');
  assert.equal(config?.id, 'a');
  assert.equal(config?.jump_host?.id, 'b');

  const cyclic = [
    { ...connections[0], jumpServerId: 'b' },
    { ...connections[1], jumpServerId: 'a' },
  ];
  const cyclicConfig = buildConnectConfig(cyclic, 'a');
  assert.equal(cyclicConfig?.jump_host?.jump_host, null);
});

console.log('Connection domain tests passed.');
