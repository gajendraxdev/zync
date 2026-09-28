import type { UsageSessionPayload } from './types.js';

const MAX_OPEN_SECONDS = 24 * 60 * 60;

export interface UsageSession {
  id: string;
  openedAt: string;
  timezone?: string;
  utcOffsetMinutes: number;
}

export function utcOffsetMinutes(now: Date): number {
  return -now.getTimezoneOffset();
}

export function localTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone || undefined;
  } catch {
    return undefined;
  }
}

export function createUsageSession(now = new Date(), id = newSessionId()): UsageSession {
  return {
    id,
    openedAt: now.toISOString(),
    timezone: localTimezone(),
    utcOffsetMinutes: utcOffsetMinutes(now),
  };
}

/** Seconds the app was open on this UTC day, capped at that day and at 24 hours. */
export function dayOpenSeconds(session: UsageSession, day: string, now: Date): number {
  const opened = new Date(session.openedAt).getTime();
  const dayStart = new Date(`${day}T00:00:00.000Z`).getTime();
  const dayEnd = dayStart + MAX_OPEN_SECONDS * 1000;
  const start = Math.max(opened, dayStart);
  const stop = Math.min(now.getTime(), dayEnd);
  return clampSeconds(stop - start);
}

export function sessionPayload(session: UsageSession, day: string, now: Date): UsageSessionPayload {
  const dayStart = new Date(`${day}T00:00:00.000Z`).getTime();
  const dayEnd = dayStart + MAX_OPEN_SECONDS * 1000;
  const opened = Math.max(new Date(session.openedAt).getTime(), dayStart);
  const closed = Math.min(Math.max(now.getTime(), opened), dayEnd);
  return {
    id: sessionIdForDay(session, day, dayStart),
    openedAt: new Date(opened).toISOString(),
    closedAt: new Date(closed).toISOString(),
    openSeconds: clampSeconds(closed - opened),
    timezone: session.timezone,
    utcOffsetMinutes: session.utcOffsetMinutes,
  };
}

function sessionIdForDay(session: UsageSession, day: string, dayStart: number): string {
  // Keep the original ID on the launch day so queued reports from older builds
  // still update the same server row. Later UTC-day segments need their own ID:
  // the server keys sessions by install ID + session ID, without a day column.
  if (day === session.openedAt.slice(0, 10)) return session.id;
  const dayNumber = Math.floor(dayStart / (MAX_OPEN_SECONDS * 1000));
  const tail = Number.parseInt(session.id.slice(-8), 16);
  const dailyTail = ((tail ^ dayNumber) >>> 0).toString(16).padStart(8, '0');
  return session.id.slice(0, -8) + dailyTail;
}

let liveSession: UsageSession | null = null;

export function currentUsageSession(): UsageSession | null {
  return liveSession;
}

export function ensureUsageSession(now = new Date()): UsageSession {
  if (!liveSession) liveSession = createUsageSession(now);
  return liveSession;
}

export function clearUsageSession(): void {
  liveSession = null;
}

function clampSeconds(ms: number): number {
  const seconds = Math.floor(ms / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.min(MAX_OPEN_SECONDS, seconds);
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}
