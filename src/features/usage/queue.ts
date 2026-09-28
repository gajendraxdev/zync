import { isUsageFeatureId, type UsageFeatureId } from './catalog.js';
import { currentUsageSession, sessionPayload } from './session.js';
import type { UsageSessionPayload } from './types.js';

const QUEUE_KEY = 'zync.usage.queue';
const MAX_PENDING_DAYS = 14;
const MAX_SESSIONS_PER_DAY = 64;
const MAX_OPEN_SECONDS = 24 * 60 * 60;
const UTC_DAY_MS = MAX_OPEN_SECONDS * 1000;

export interface UsageDayQueue {
  day: string;
  features: Partial<Record<UsageFeatureId, number>>;
  openSeconds?: number;
  sessions?: UsageSessionPayload[];
  dirty: boolean;
}

export interface UsageQueueState {
  current: UsageDayQueue;
  pending: UsageDayQueue[];
  lastFlushAt: number | null;
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function emptyDay(day: string, dirty = true): UsageDayQueue {
  return { day, features: {}, dirty };
}

export function createQueueState(now = new Date()): UsageQueueState {
  return { current: emptyDay(utcDay(now)), pending: [], lastFlushAt: null };
}

export function loadQueue(now = new Date()): UsageQueueState {
  const today = utcDay(now);
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return createQueueState(now);
    const parsed = JSON.parse(raw) as Partial<UsageQueueState> & { pending?: unknown };
    const current = normalizeDay(parsed.current, today);
    let pending = normalizePending(parsed.pending);
    const state = {
      current,
      pending,
      lastFlushAt: typeof parsed.lastFlushAt === 'number' ? parsed.lastFlushAt : null,
    };
    return current.day === today ? state : checkpointUsage(state, now);
  } catch {
    return createQueueState(now);
  }
}

export function saveQueue(state: UsageQueueState): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota
  }
}

export function bumpFeature(state: UsageQueueState, feature: UsageFeatureId, now = new Date()): UsageQueueState {
  const today = utcDay(now);
  const checkpointed = checkpointUsage(state, now);
  const current = checkpointed.current;
  const nextCount = (current.features[feature] ?? 0) + 1;
  return {
    ...checkpointed,
    current: {
      ...current,
      day: today,
      features: { ...current.features, [feature]: nextCount },
      dirty: true,
    },
  };
}

export function dropPendingDay(state: UsageQueueState, day: string, now = Date.now()): UsageQueueState {
  return {
    ...state,
    pending: state.pending.filter((item) => item.day !== day),
    lastFlushAt: now,
  };
}

export function markCurrentFlushed(state: UsageQueueState, sent: UsageDayQueue, now = Date.now()): UsageQueueState {
  if (state.current.day !== sent.day) {
    return { ...state, lastFlushAt: now };
  }
  return {
    ...state,
    current: {
      ...state.current,
      dirty: hasNewData(state.current, sent),
    },
    lastFlushAt: now,
  };
}

function hasNewData(live: UsageDayQueue, sent: UsageDayQueue): boolean {
  for (const id of Object.keys({ ...live.features, ...sent.features })) {
    if (!isUsageFeatureId(id)) continue;
    if ((live.features[id] ?? 0) > (sent.features[id] ?? 0)) return true;
  }

  if ((live.openSeconds ?? 0) > (sent.openSeconds ?? 0)) return true;

  const sentSessions = new Map((sent.sessions ?? []).map((session) => [session.id, session]));
  for (const session of live.sessions ?? []) {
    const previous = sentSessions.get(session.id);
    if (!previous) return true;
    if ((session.openSeconds ?? 0) > (previous.openSeconds ?? 0)) return true;
    if ((session.closedAt ?? '') > (previous.closedAt ?? '')) return true;
  }

  return false;
}

/** Persist the live launch into the appropriate UTC day before a flush or rollover. */
export function checkpointUsage(state: UsageQueueState, now = new Date()): UsageQueueState {
  const today = utcDay(now);
  let current = state.current;
  let pending = state.pending;

  while (current.day < today) {
    const nextDay = followingUtcDay(current.day);
    if (!nextDay || nextDay > today) break;
    const rolled = rollDay(
      current,
      pending,
      new Date(`${nextDay}T00:00:00.000Z`),
      nextDay === today,
    );
    current = rolled.current;
    pending = rolled.pending;
  }

  if (current.day !== today) {
    const rolled = rollDay(current, pending, now);
    current = rolled.current;
    pending = rolled.pending;
  }

  return {
    ...state,
    current: captureSession(current, now),
    pending,
  };
}

/** Snapshot open time before a UTC day moves to the pending flush. */
export function sealDay(day: UsageDayQueue, now = new Date()): UsageDayQueue {
  return captureSession(day, now);
}

function captureSession(day: UsageDayQueue, now: Date): UsageDayQueue {
  const session = currentUsageSession();
  if (!session) return day;
  const dayStart = new Date(`${day.day}T00:00:00.000Z`).getTime();
  const dayEndMs = dayStart + MAX_OPEN_SECONDS * 1000;
  const opened = new Date(session.openedAt).getTime();
  if (opened >= dayEndMs || now.getTime() <= dayStart) return day;
  const dayEnd = new Date(dayEndMs);
  const stop = now.getTime() < dayEnd.getTime() ? now : dayEnd;
  const nextSession = sessionPayload(session, day.day, stop);
  const sessions = day.sessions ?? [];
  // Older builds used the launch ID on both sides of midnight. Replace that
  // queued segment in place, preserving its duration instead of adding it twice.
  const legacyId = nextSession.id !== session.id ? session.id : undefined;
  const previous = sessions.find((item) => item.id === nextSession.id)
    ?? sessions.find((item) => item.id === legacyId);
  const mergedSession = previous
    ? { ...mergeSession(previous, nextSession), id: nextSession.id }
    : nextSession;
  const previousSeconds = previous?.openSeconds ?? 0;
  const additionalSeconds = Math.max(0, (mergedSession.openSeconds ?? 0) - previousSeconds);
  const baselineSeconds = day.openSeconds ?? sumSessionSeconds(sessions);
  const openSeconds = Math.min(MAX_OPEN_SECONDS, baselineSeconds + additionalSeconds);
  const nextSessions = [
    ...sessions.filter((item) => item.id !== mergedSession.id && item.id !== legacyId),
    mergedSession,
  ].slice(-MAX_SESSIONS_PER_DAY);
  const changed = openSeconds !== day.openSeconds
    || !previous
    || mergedSession.id !== previous.id
    || mergedSession.closedAt !== previous.closedAt
    || mergedSession.openSeconds !== previous.openSeconds;

  return {
    ...day,
    openSeconds,
    sessions: nextSessions,
    dirty: day.dirty || changed,
  };
}

function rollDay(
  current: UsageDayQueue,
  pending: UsageDayQueue[],
  now: Date,
  nextDayDirty = true,
): { current: UsageDayQueue; pending: UsageDayQueue[] } {
  const sealed = sealDay(current, now);
  if (sealed.dirty) pending = retainPending(pending, sealed);
  return { current: emptyDay(utcDay(now), nextDayDirty), pending };
}

function followingUtcDay(day: string): string | null {
  const start = new Date(`${day}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(start)) return null;
  return new Date(start + UTC_DAY_MS).toISOString().slice(0, 10);
}

function retainPending(pending: UsageDayQueue[], day: UsageDayQueue): UsageDayQueue[] {
  const without = pending.filter((item) => item.day !== day.day);
  const next = [...without, day];
  if (next.length <= MAX_PENDING_DAYS) return next;
  return next.slice(next.length - MAX_PENDING_DAYS);
}

function normalizePending(raw: unknown): UsageDayQueue[] {
  const items: UsageDayQueue[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const day = normalizeDay(item as UsageDayQueue, '');
      if (day.day) items.push(day);
    }
  } else if (raw && typeof raw === 'object') {
    const day = normalizeDay(raw as UsageDayQueue, '');
    if (day.day) items.push(day);
  }
  let pending: UsageDayQueue[] = [];
  for (const item of items) {
    pending = retainPending(pending, item);
  }
  return pending;
}

function normalizeDay(raw: UsageDayQueue | undefined, fallbackDay: string): UsageDayQueue {
  const day = typeof raw?.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.day) ? raw.day : fallbackDay;
  const features: Partial<Record<UsageFeatureId, number>> = {};
  if (raw?.features && typeof raw.features === 'object') {
    for (const [id, count] of Object.entries(raw.features)) {
      if (!isUsageFeatureId(id)) continue;
      const n = typeof count === 'number' && Number.isFinite(count) ? Math.max(0, Math.min(10_000, Math.floor(count))) : 0;
      if (n > 0) features[id] = n;
    }
  }
  const openSeconds = typeof raw?.openSeconds === 'number' && Number.isFinite(raw.openSeconds)
    ? Math.max(0, Math.min(MAX_OPEN_SECONDS, Math.floor(raw.openSeconds)))
    : undefined;
  const sessions = normalizeSessions(raw?.sessions);
  return { day, features, openSeconds, sessions, dirty: raw?.dirty !== false };
}

function normalizeSessions(raw: unknown): UsageSessionPayload[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  let sessions: UsageSessionPayload[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<UsageSessionPayload>;
    if (typeof row.id !== 'string' || typeof row.openedAt !== 'string') continue;
    const session: UsageSessionPayload = { id: row.id, openedAt: row.openedAt };
    if (typeof row.closedAt === 'string') session.closedAt = row.closedAt;
    if (typeof row.openSeconds === 'number' && Number.isFinite(row.openSeconds)) {
      session.openSeconds = Math.max(0, Math.min(MAX_OPEN_SECONDS, Math.floor(row.openSeconds)));
    }
    if (typeof row.timezone === 'string' && row.timezone) session.timezone = row.timezone;
    if (typeof row.utcOffsetMinutes === 'number' && Number.isFinite(row.utcOffsetMinutes)) {
      session.utcOffsetMinutes = Math.trunc(row.utcOffsetMinutes);
    }
    const previous = sessions.find((candidate) => candidate.id === session.id);
    sessions = [
      ...sessions.filter((candidate) => candidate.id !== session.id),
      previous ? mergeSession(previous, session) : session,
    ].slice(-MAX_SESSIONS_PER_DAY);
  }
  return sessions.length > 0 ? sessions : undefined;
}

function mergeSession(previous: UsageSessionPayload, next: UsageSessionPayload): UsageSessionPayload {
  return {
    id: previous.id,
    openedAt: previous.openedAt <= next.openedAt ? previous.openedAt : next.openedAt,
    closedAt: latestTimestamp(previous.closedAt, next.closedAt),
    openSeconds: Math.max(previous.openSeconds ?? 0, next.openSeconds ?? 0),
    timezone: previous.timezone ?? next.timezone,
    utcOffsetMinutes: previous.utcOffsetMinutes ?? next.utcOffsetMinutes,
  };
}

function latestTimestamp(left?: string, right?: string): string | undefined {
  if (!left) return right;
  if (!right) return left;
  return left >= right ? left : right;
}

function sumSessionSeconds(sessions: UsageSessionPayload[]): number {
  return Math.min(
    MAX_OPEN_SECONDS,
    sessions.reduce((total, session) => total + (session.openSeconds ?? 0), 0),
  );
}
