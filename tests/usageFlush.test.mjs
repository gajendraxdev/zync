import assert from 'node:assert/strict';

import { createUsageFlusher } from '../.tmp-agent-tests/src/features/usage/flush.js';
import { fitUsagePayload, MAX_USAGE_PAYLOAD_BYTES } from '../.tmp-agent-tests/src/features/usage/payload.js';
import { createQueueState } from '../.tmp-agent-tests/src/features/usage/queue.js';

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    throw error;
  }
}

function createHarness({ enabled = true, submit } = {}) {
  let state = createQueueState(new Date('2026-09-24T12:00:00.000Z'));
  let submissions = 0;
  let saves = 0;
  const flush = createUsageFlusher({
    isEnabled: () => enabled,
    now: () => new Date('2026-09-24T12:05:00.000Z'),
    load: () => state,
    save: (next) => {
      state = next;
      saves += 1;
    },
    submit: async (payload) => {
      submissions += 1;
      return submit ? submit(payload, submissions) : { status: 'accepted' };
    },
    makePayload: async (day) => ({
      schemaVersion: 1,
      installId: '11111111-1111-4111-8111-111111111111',
      day: day.day,
      features: [],
      openSeconds: day.openSeconds,
      sessions: day.sessions,
    }),
  });
  return {
    flush,
    getState: () => state,
    getSubmissions: () => submissions,
    getSaves: () => saves,
    setEnabled: (value) => { enabled = value; },
    setState: (next) => { state = next; },
  };
}

await run('failed reports stay dirty and retry successfully', async () => {
  const harness = createHarness({
    submit: async (_payload, attempt) => {
      if (attempt === 1) throw new Error('offline');
      return { status: 'accepted' };
    },
  });

  await harness.flush(true);
  assert.equal(harness.getState().current.dirty, true);
  await harness.flush(true);
  assert.equal(harness.getSubmissions(), 2);
  assert.equal(harness.getState().current.dirty, false);
});

await run('opt-out performs no queue or network work', async () => {
  const harness = createHarness({ enabled: false });
  await harness.flush(true);
  assert.equal(harness.getSubmissions(), 0);
  assert.equal(harness.getSaves(), 0);
});

await run('expired pending reports are removed after the accepted response', async () => {
  const harness = createHarness({ submit: async () => ({ status: 'expired' }) });
  const current = harness.getState().current;
  harness.setState({
    current: { ...current, dirty: false },
    pending: [{ day: '2026-09-10', features: { files: 1 }, dirty: true }],
    lastFlushAt: new Date('2026-09-24T12:05:00.000Z').getTime(),
  });

  await harness.flush(false);
  assert.equal(harness.getState().pending.length, 0);
  assert.equal(harness.getSubmissions(), 1);
});

await run('a forced close flush is queued behind an active request', async () => {
  let releaseFirst;
  const firstRequest = new Promise((resolve) => { releaseFirst = resolve; });
  const harness = createHarness({
    submit: async (_payload, attempt) => {
      if (attempt === 1) await firstRequest;
      return { status: 'accepted' };
    },
  });

  const intervalFlush = harness.flush(false);
  const closeFlush = harness.flush(true);
  assert.ok(harness.getSaves() > 0);
  releaseFirst();
  await Promise.all([intervalFlush, closeFlush]);
  assert.equal(harness.getSubmissions(), 2);
});

await run('payload fitting respects the server body and session limits', async () => {
  const sessions = Array.from({ length: 80 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`,
    openedAt: '2026-09-24T12:00:00.000Z',
    closedAt: '2026-09-24T12:05:00.000Z',
    openSeconds: 300,
    timezone: `Region/${'x'.repeat(40)}`,
    utcOffsetMinutes: 330,
  }));
  const payload = fitUsagePayload({
    schemaVersion: 1,
    installId: '11111111-1111-4111-8111-111111111111',
    day: '2026-09-24',
    features: [{ id: 'files', count: 1 }],
    sessions,
  });
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;

  assert.ok((payload.sessions?.length ?? 0) <= 64);
  assert.ok(bytes <= MAX_USAGE_PAYLOAD_BYTES);
  assert.equal(payload.sessions?.at(-1)?.id, sessions.at(-1).id);
});
