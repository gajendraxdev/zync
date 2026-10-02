import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseSnapshot,
  parseReplies,
  mergeThreadPages,
  isInboxCredentialStorageError,
} from '../.tmp-agent-tests/src/features/feedbackInbox/protocol.js';

test('only tagged credential-storage errors allow legacy submission fallback', () => {
  assert.equal(isInboxCredentialStorageError('INBOX_CREDENTIAL_STORAGE_UNAVAILABLE: keyring locked'), true);
  assert.equal(isInboxCredentialStorageError(new Error('INBOX_CREDENTIAL_STORAGE_UNAVAILABLE: keyring locked')), true);
  for (const error of [
    'Could not reach feedback inbox',
    'Could not save inbox enrollment',
    'Feedback inbox credential is damaged',
    'INBOX_CREDENTIAL_STORAGE_UNAVAILABLE',
    { message: 'INBOX_CREDENTIAL_STORAGE_UNAVAILABLE: forged object' },
  ]) assert.equal(isInboxCredentialStorageError(error), false);
});

const id = '11111111-1111-4111-8111-111111111111';
const date = '2026-10-01T10:00:00Z';
const thread = {
  kind: 'feedback',
  id,
  sequence: 1,
  category: 'bug',
  message: '<script>plain text</script>',
  createdAt: date,
  closedAt: null,
  unread: 1,
};
const snapshot = { threads: [thread], unread: 1, active: true, nextBefore: 0 };

test('shared history accepts survey threads and preserves feedback-only server compatibility', () => {
  const survey = { ...thread, kind: 'survey', category: 'Release survey' };
  assert.deepEqual(parseSnapshot({ ...snapshot, threads: [survey] }).threads, [survey]);
  const { kind, ...legacyThread } = thread;
  assert.deepEqual(parseSnapshot({ ...snapshot, threads: [legacyThread] }).threads, [thread]);
});
test('refreshed threads preserve older pages and update matching summaries without duplicates', () => {
  const older = { ...thread, id: '22222222-2222-4222-8222-222222222222', sequence: 1 };
  const newest = { ...thread, sequence: 3 };
  const refreshed = { ...newest, unread: 0, closedAt: date };
  const added = { ...thread, id: '33333333-3333-4333-8333-333333333333', sequence: 4 };
  assert.deepEqual(mergeThreadPages([newest, older], [added, refreshed]), [added, refreshed, older]);
  assert.deepEqual(mergeThreadPages([newest, older], []), [newest, older]);
});
test('inbox snapshots retain plain text and never implicitly acknowledge replies', () => {
  assert.deepEqual(parseSnapshot(snapshot), snapshot);
  const replies = {
    replyTo: id,
    replies: [
      {
        sender: 'team',
        id,
        sequence: 1,
        message: '<img onerror=alert(1)>',
        createdAt: date,
        readAt: null,
      },
    ],
    nextAfter: 0,
  };
  assert.deepEqual(parseReplies(replies), replies);
  assert.equal(parseReplies({ replies: [], nextAfter: 0 }).replyTo, null);
  assert.equal(parseReplies({ ...replies, replies: [{ ...replies.replies[0], sender: 'user' }] }).replies[0].sender, 'user');
  assert.throws(() => parseReplies({ ...replies, replyTo: '../invalid' }));
  assert.throws(() => parseReplies({ ...replies, replies: [{ ...replies.replies[0], sender: 'admin' }] }));
});
test('inbox response validation rejects malformed counts, payloads and cursors', () => {
  for (const bad of [
    null,
    [],
    { ...snapshot, unread: -1 },
    { ...snapshot, active: 'true' },
    { ...snapshot, nextBefore: Infinity },
    { ...snapshot, threads: Array(51).fill(thread) },
    { ...snapshot, threads: [{ ...thread, id: '../other' }] },
    { ...snapshot, threads: [{ ...thread, createdAt: 'invalid' }] },
    { ...snapshot, threads: [{ ...thread, kind: 'unknown' }] },
  ])
    assert.throws(() => parseSnapshot(bad));
  for (const bad of [
    null,
    { replies: [], nextAfter: -1 },
    {
      replies: [
        { id, sequence: 1, message: {}, createdAt: date, readAt: null },
      ],
      nextAfter: 0,
    },
  ])
    assert.throws(() => parseReplies(bad));
});
