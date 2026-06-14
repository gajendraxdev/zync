import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatConnectionsRestoreSuccessMessage,
  normalizeConnectionsRestoreArgs,
} from '../.tmp-agent-tests/src/vault/connectionsRestore.js';

test('normalizeConnectionsRestoreArgs applies defaults', () => {
  assert.deepEqual(normalizeConnectionsRestoreArgs(), {
    includeHostDefinitions: true,
    includeTunnels: true,
    includeHostSnippets: true,
    includeReferencedCredentials: true,
    hostLogicalIds: undefined,
  });
});

test('normalizeConnectionsRestoreArgs trims and drops empty host ids', () => {
  assert.deepEqual(
    normalizeConnectionsRestoreArgs({
      hostLogicalIds: [' host-a ', '', '  '],
    }),
    {
      includeHostDefinitions: true,
      includeTunnels: true,
      includeHostSnippets: true,
      includeReferencedCredentials: true,
      hostLogicalIds: ['host-a'],
    },
  );
});

test('formatConnectionsRestoreSuccessMessage summarizes restored domains', () => {
  const message = formatConnectionsRestoreSuccessMessage({
    syncedAt: 1,
    hosts: {
      scanned: 2,
      restored: 1,
      updated: 1,
      skipped: 0,
      failed: 0,
      syncedAt: 1,
      credentialsRestored: 1,
      credentialsUpdated: 0,
      credentialsSkipped: 0,
      credentialsFailed: 0,
      credentialsConflicts: 0,
    },
    tunnels: {
      domain: 'tunnels',
      scanned: 1,
      restored: 1,
      updated: 0,
      skipped: 0,
      skippedOrphaned: 0,
      failed: 0,
      syncedAt: 1,
    },
    hostSnippets: {
      domain: 'snippets',
      scanned: 1,
      restored: 0,
      updated: 1,
      skipped: 0,
      skippedOrphaned: 0,
      failed: 0,
      syncedAt: 1,
    },
  });

  assert.equal(
    message,
    'Restored connections from Google (2 hosts; 1 credential; 1 tunnel; 1 host snippet).',
  );
});

test('formatConnectionsRestoreSuccessMessage handles empty restore', () => {
  const message = formatConnectionsRestoreSuccessMessage({
    syncedAt: 1,
    hosts: {
      scanned: 0,
      restored: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      syncedAt: 1,
      credentialsRestored: 0,
      credentialsUpdated: 0,
      credentialsSkipped: 0,
      credentialsFailed: 0,
      credentialsConflicts: 0,
    },
  });

  assert.equal(message, 'No connection changes restored from Google.');
});