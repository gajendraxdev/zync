import assert from 'node:assert/strict';
import {
  bumpFeature,
  checkpointUsage,
  createQueueState,
  loadQueue,
  markCurrentFlushed,
  saveQueue,
  sealDay,
  utcDay,
} from '../.tmp-agent-tests/src/features/usage/queue.js';
import { clearUsageSession, ensureUsageSession } from '../.tmp-agent-tests/src/features/usage/session.js';

function run(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    throw error;
  }
}

run('utcDay is YYYY-MM-DD', () => {
  assert.match(utcDay(new Date('2026-09-20T15:00:00.000Z')), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(utcDay(new Date('2026-09-20T15:00:00.000Z')), '2026-09-20');
});

run('bumpFeature increments and marks dirty', () => {
  const next = bumpFeature(createQueueState(new Date('2026-09-20T12:00:00.000Z')), 'files', new Date('2026-09-20T12:00:00.000Z'));
  assert.equal(next.current.features.files, 1);
  assert.equal(next.current.dirty, true);
  const twice = bumpFeature(next, 'files', new Date('2026-09-20T12:01:00.000Z'));
  assert.equal(twice.current.features.files, 2);
});

run('many UTC rollovers keep the 14-day server backfill window', () => {
  let state = createQueueState(new Date('2026-09-01T12:00:00.000Z'));
  for (let day = 1; day <= 18; day += 1) {
    const stamp = `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`;
    state = bumpFeature(state, 'files', new Date(stamp));
  }
  assert.equal(state.pending.length, 14);
  assert.equal(state.pending[0].day, '2026-09-04');
  assert.equal(state.current.day, '2026-09-18');
});

run('markCurrentFlushed clears dirty when counts did not grow', () => {
  const sent = bumpFeature(createQueueState(new Date('2026-09-20T12:00:00.000Z')), 'files', new Date('2026-09-20T12:00:00.000Z'));
  const flushed = markCurrentFlushed(sent, sent.current, 1_000);
  assert.equal(flushed.current.dirty, false);
  assert.equal(flushed.lastFlushAt, 1_000);
});

run('markCurrentFlushed keeps dirty when counts grew after the snapshot', () => {
  const sent = bumpFeature(createQueueState(new Date('2026-09-20T12:00:00.000Z')), 'files', new Date('2026-09-20T12:00:00.000Z'));
  const grew = bumpFeature(sent, 'files', new Date('2026-09-20T12:01:00.000Z'));
  const flushed = markCurrentFlushed(grew, sent.current, 2_000);
  assert.equal(flushed.current.dirty, true);
  assert.equal(flushed.current.features.files, 2);
  assert.equal(flushed.lastFlushAt, 2_000);
});

run('UTC rollover stores that day open time before it becomes pending', () => {
  clearUsageSession();
  ensureUsageSession(new Date('2026-09-23T22:00:00.000Z'));
  const day = createQueueState(new Date('2026-09-23T22:00:00.000Z'));
  const sealed = sealDay(day.current, new Date('2026-09-24T01:30:00.000Z'));
  assert.equal(sealed.openSeconds, 2 * 60 * 60);
  assert.equal(sealed.sessions.length, 1);
  assert.equal(sealed.sessions[0].closedAt, '2026-09-24T00:00:00.000Z');
  clearUsageSession();
});

run('a session that starts the next day does not seal the previous day', () => {
  clearUsageSession();
  ensureUsageSession(new Date('2026-09-24T01:00:00.000Z'));
  const day = createQueueState(new Date('2026-09-23T22:00:00.000Z'));
  const sealed = sealDay(day.current, new Date('2026-09-24T01:30:00.000Z'));
  assert.equal(sealed.openSeconds, undefined);
  assert.equal(sealed.sessions, undefined);
  clearUsageSession();
});

run('UTC rollover keeps the unsent day in pending', () => {
  const day1 = bumpFeature(createQueueState(new Date('2026-09-20T12:00:00.000Z')), 'files', new Date('2026-09-20T12:00:00.000Z'));
  const day2 = bumpFeature(day1, 'tunnels', new Date('2026-09-21T01:00:00.000Z'));
  assert.equal(day2.current.day, '2026-09-21');
  assert.equal(day2.pending.length, 1);
  assert.equal(day2.pending[0].day, '2026-09-20');
  assert.equal(day2.pending[0].features.files, 1);
});

run('two launches on one UTC day accumulate time and preserve both sessions', () => {
  clearUsageSession();
  let state = bumpFeature(
    createQueueState(new Date('2026-09-24T08:00:00.000Z')),
    'files',
    new Date('2026-09-24T08:00:00.000Z'),
  );
  const first = ensureUsageSession(new Date('2026-09-24T08:00:00.000Z'));
  state = checkpointUsage(state, new Date('2026-09-24T08:10:00.000Z'));

  clearUsageSession();
  const second = ensureUsageSession(new Date('2026-09-24T12:00:00.000Z'));
  state = checkpointUsage(state, new Date('2026-09-24T12:05:00.000Z'));

  assert.equal(state.current.openSeconds, 15 * 60);
  assert.equal(state.current.sessions.length, 2);
  assert.notEqual(first.id, second.id);
  assert.equal(state.current.features.files, 1);
  clearUsageSession();
});

run('midnight rollover seals yesterday and starts today from the same live launch', () => {
  clearUsageSession();
  ensureUsageSession(new Date('2026-09-24T23:50:00.000Z'));
  let state = createQueueState(new Date('2026-09-24T23:50:00.000Z'));
  state = checkpointUsage(state, new Date('2026-09-24T23:55:00.000Z'));
  state = checkpointUsage(state, new Date('2026-09-25T00:10:00.000Z'));

  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].day, '2026-09-24');
  assert.equal(state.pending[0].openSeconds, 10 * 60);
  assert.equal(state.current.day, '2026-09-25');
  assert.equal(state.current.openSeconds, 10 * 60);
  assert.notEqual(state.pending[0].sessions[0].id, state.current.sessions[0].id);
  assert.match(state.current.sessions[0].id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  clearUsageSession();
});

run('old queued midnight segment upgrades its ID without doubling duration', () => {
  clearUsageSession();
  const session = ensureUsageSession(new Date('2026-09-24T23:50:00.000Z'));
  const day = '2026-09-25';
  const legacy = {
    day,
    features: {},
    openSeconds: 5 * 60,
    sessions: [{
      id: session.id,
      openedAt: '2026-09-25T00:00:00.000Z',
      closedAt: '2026-09-25T00:05:00.000Z',
      openSeconds: 5 * 60,
    }],
    dirty: false,
  };
  const state = checkpointUsage({ current: legacy, pending: [], lastFlushAt: null }, new Date('2026-09-25T00:10:00.000Z'));
  assert.equal(state.current.openSeconds, 10 * 60);
  assert.equal(state.current.sessions.length, 1);
  assert.notEqual(state.current.sessions[0].id, session.id);
  clearUsageSession();
});

run('session ID migration marks an otherwise unchanged queued day dirty', () => {
  clearUsageSession();
  const session = ensureUsageSession(new Date('2026-09-24T23:50:00.000Z'));
  const legacy = {
    day: '2026-09-25',
    features: {},
    openSeconds: 5 * 60,
    sessions: [{
      id: session.id,
      openedAt: '2026-09-25T00:00:00.000Z',
      closedAt: '2026-09-25T00:05:00.000Z',
      openSeconds: 5 * 60,
    }],
    dirty: false,
  };
  const state = checkpointUsage(
    { current: legacy, pending: [], lastFlushAt: null },
    new Date('2026-09-25T00:05:00.000Z'),
  );

  assert.equal(state.current.openSeconds, 5 * 60);
  assert.equal(state.current.sessions.length, 1);
  assert.notEqual(state.current.sessions[0].id, session.id);
  assert.equal(state.current.dirty, true);
  clearUsageSession();
});

run('multi-day rollover captures every UTC segment of one live launch', () => {
  clearUsageSession();
  ensureUsageSession(new Date('2026-09-24T23:50:00.000Z'));
  const state = checkpointUsage(
    createQueueState(new Date('2026-09-24T23:50:00.000Z')),
    new Date('2026-09-27T00:10:00.000Z'),
  );

  assert.deepEqual(state.pending.map((day) => day.day), [
    '2026-09-24',
    '2026-09-25',
    '2026-09-26',
  ]);
  assert.deepEqual(state.pending.map((day) => day.openSeconds), [
    10 * 60,
    24 * 60 * 60,
    24 * 60 * 60,
  ]);
  assert.equal(state.current.day, '2026-09-27');
  assert.equal(state.current.openSeconds, 10 * 60);
  assert.equal(new Set([
    ...state.pending.flatMap((day) => day.sessions.map((session) => session.id)),
    ...state.current.sessions.map((session) => session.id),
  ]).size, 4);
  clearUsageSession();
});

run('restart gaps do not create reports for days when the app was closed', () => {
  clearUsageSession();
  const previous = bumpFeature(
    createQueueState(new Date('2026-09-24T12:00:00.000Z')),
    'files',
    new Date('2026-09-24T12:00:00.000Z'),
  );
  const state = checkpointUsage(previous, new Date('2026-09-27T08:00:00.000Z'));

  assert.deepEqual(state.pending.map((day) => day.day), ['2026-09-24']);
  assert.equal(state.current.day, '2026-09-27');
  assert.equal(state.current.openSeconds, undefined);
  assert.equal(state.current.sessions, undefined);
});

run('restart reloads pending timing and adds the next launch without losing features', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  clearUsageSession();
  ensureUsageSession(new Date('2026-09-24T08:00:00.000Z'));
  let state = bumpFeature(
    createQueueState(new Date('2026-09-24T08:00:00.000Z')),
    'terminal',
    new Date('2026-09-24T08:00:00.000Z'),
  );
  state = checkpointUsage(state, new Date('2026-09-24T08:10:00.000Z'));
  saveQueue(state);

  clearUsageSession();
  ensureUsageSession(new Date('2026-09-24T12:00:00.000Z'));
  const restored = checkpointUsage(
    loadQueue(new Date('2026-09-24T12:05:00.000Z')),
    new Date('2026-09-24T12:05:00.000Z'),
  );

  assert.equal(restored.current.openSeconds, 15 * 60);
  assert.equal(restored.current.sessions.length, 2);
  assert.equal(restored.current.features.terminal, 1);
  clearUsageSession();
});

run('feature updates retain checkpointed timing data', () => {
  clearUsageSession();
  ensureUsageSession(new Date('2026-09-24T08:00:00.000Z'));
  const checkpointed = checkpointUsage(
    createQueueState(new Date('2026-09-24T08:00:00.000Z')),
    new Date('2026-09-24T08:10:00.000Z'),
  );
  const updated = bumpFeature(checkpointed, 'files', new Date('2026-09-24T08:11:00.000Z'));

  assert.equal(updated.current.openSeconds, 11 * 60);
  assert.equal(updated.current.sessions.length, 1);
  assert.equal(updated.current.features.files, 1);
  clearUsageSession();
});
