import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeHostCatalog,
  filterHostCatalog,
  searchHostCatalog,
  connectionLogicalId,
  remoteOnlyCatalogEntries,
} from '../.tmp-agent-tests/src/features/connections/domain/hostCatalog.js';

test('connectionLogicalId prefers connection id', () => {
  assert.equal(
    connectionLogicalId({ id: 'host-1', username: 'u', host: 'h', port: 22 }),
    'host-1',
  );
});

test('merges local and google inventory by logicalId into one row', () => {
  const local = [
    {
      id: 'host-1',
      name: 'Prod',
      host: '10.0.0.1',
      username: 'root',
      port: 22,
      status: 'disconnected',
    },
  ];
  const inventory = [
    {
      provider: 'google',
      collectionId: 'col',
      logicalId: 'host-1',
      name: 'Prod Remote Name',
      host: '10.0.0.1',
      port: 22,
      username: 'root',
      tags: [],
      isFavorite: false,
      updatedAt: 1,
      revision: 1,
      hasAuthRef: true,
      localExists: true,
    },
    {
      provider: 'google',
      collectionId: 'col',
      logicalId: 'host-2',
      name: 'Staging',
      host: '10.0.0.2',
      port: 22,
      username: 'ubuntu',
      tags: ['web'],
      isFavorite: false,
      updatedAt: 2,
      revision: 3,
      hasAuthRef: false,
      localExists: false,
    },
  ];

  const merged = mergeHostCatalog(local, inventory);
  assert.equal(merged.length, 2);

  const host1 = merged.find(e => e.logicalId === 'host-1');
  assert.ok(host1);
  assert.deepEqual(host1.locations, ['local', 'google']);
  assert.equal(host1.name, 'Prod');
  assert.ok(host1.local);

  const host2 = merged.find(e => e.logicalId === 'host-2');
  assert.ok(host2);
  assert.deepEqual(host2.locations, ['google']);
  assert.equal(host2.local, undefined);
});

test('filters and remote-only helpers', () => {
  const entries = mergeHostCatalog(
    [
      {
        id: 'a',
        name: 'A',
        host: 'a.example',
        username: 'u',
        port: 22,
        status: 'disconnected',
      },
    ],
    [
      {
        provider: 'google',
        collectionId: 'c',
        logicalId: 'b',
        name: 'B',
        host: 'b.example',
        port: 22,
        username: 'u',
        tags: [],
        isFavorite: false,
        updatedAt: 0,
        revision: 1,
        hasAuthRef: false,
        localExists: false,
      },
    ],
  );

  assert.equal(filterHostCatalog(entries, 'local').length, 1);
  assert.equal(filterHostCatalog(entries, 'remote').length, 1);
  assert.equal(filterHostCatalog(entries, 'all').length, 2);
  assert.equal(remoteOnlyCatalogEntries(entries).length, 1);
  assert.equal(searchHostCatalog(entries, 'b.example').length, 1);
});

test('skips local shell pseudo-connection', () => {
  const merged = mergeHostCatalog(
    [{ id: 'local', name: 'Local', host: 'localhost', username: '', port: 0, status: 'connected' }],
    [],
  );
  assert.equal(merged.length, 0);
});
