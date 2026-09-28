import type { UsagePayload, UsageSessionPayload } from './types.js';

export const MAX_USAGE_PAYLOAD_BYTES = 8 * 1024;
export const MAX_USAGE_SESSIONS = 64;

export function fitUsagePayload(payload: UsagePayload): UsagePayload {
  const sessions = newestSessions(payload.sessions);
  if (sessions.length === 0) {
    const { sessions: _sessions, ...withoutSessions } = payload;
    return withoutSessions;
  }

  const fitted = { ...payload, sessions };
  while (fitted.sessions.length > 0 && payloadBytes(fitted) > MAX_USAGE_PAYLOAD_BYTES) {
    fitted.sessions.shift();
  }

  if (fitted.sessions.length > 0) return fitted;
  const { sessions: _sessions, ...withoutSessions } = fitted;
  return withoutSessions;
}

function newestSessions(sessions: UsageSessionPayload[] | undefined): UsageSessionPayload[] {
  if (!sessions) return [];
  return sessions.slice(-MAX_USAGE_SESSIONS);
}

function payloadBytes(payload: UsagePayload): number {
  return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
}
