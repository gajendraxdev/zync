import assert from 'node:assert/strict';
import { createUsageSession, dayOpenSeconds, sessionPayload, utcOffsetMinutes } from '../.tmp-agent-tests/src/features/usage/session.js';

function run(name, fn) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`not ok ${name}`);
    throw error;
  }
}

run('day open time starts at UTC midnight when the app was already open', () => {
  const session = createUsageSession(new Date('2026-09-23T22:00:00.000Z'), '11111111-1111-4111-8111-111111111111');
  const now = new Date('2026-09-24T01:30:00.000Z');
  assert.equal(dayOpenSeconds(session, '2026-09-24', now), 90 * 60);
});

run('session payload records close time and timezone offset', () => {
  const opened = new Date('2026-09-24T04:00:00.000Z');
  const session = {
    id: '22222222-2222-4222-8222-222222222222',
    openedAt: opened.toISOString(),
    timezone: 'Asia/Kolkata',
    utcOffsetMinutes: utcOffsetMinutes(new Date('2026-09-24T04:00:00.000Z')),
  };
  const payload = sessionPayload(session, new Date('2026-09-24T04:20:00.000Z'));
  assert.equal(payload.id, session.id);
  assert.equal(payload.openedAt, session.openedAt);
  assert.equal(payload.closedAt, '2026-09-24T04:20:00.000Z');
  assert.equal(payload.openSeconds, 20 * 60);
  assert.equal(payload.timezone, 'Asia/Kolkata');
});
