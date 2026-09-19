import { isUsageFeatureId, type UsageFeatureId } from './catalog.js';

const QUEUE_KEY = 'zync.usage.queue';
const MAX_PENDING_DAYS = 7;

export interface UsageDayQueue {
  day: string;
  features: Partial<Record<UsageFeatureId, number>>;
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

function emptyDay(day: string): UsageDayQueue {
  return { day, features: {}, dirty: true };
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
    if (current.day !== today) {
      if (current.dirty) pending = retainPending(pending, current);
      return {
        current: emptyDay(today),
        pending,
        lastFlushAt: typeof parsed.lastFlushAt === 'number' ? parsed.lastFlushAt : null,
      };
    }
    return {
      current,
      pending,
      lastFlushAt: typeof parsed.lastFlushAt === 'number' ? parsed.lastFlushAt : null,
    };
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
  let current = state.current;
  let pending = state.pending;
  if (current.day !== today) {
    if (current.dirty) pending = retainPending(pending, current);
    current = emptyDay(today);
  }
  const nextCount = (current.features[feature] ?? 0) + 1;
  return {
    ...state,
    pending,
    current: {
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
      dirty: hasNewCounts(state.current, sent),
    },
    lastFlushAt: now,
  };
}

function hasNewCounts(live: UsageDayQueue, sent: UsageDayQueue): boolean {
  for (const id of Object.keys({ ...live.features, ...sent.features })) {
    if (!isUsageFeatureId(id)) continue;
    if ((live.features[id] ?? 0) > (sent.features[id] ?? 0)) return true;
  }
  return false;
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
  return { day, features, dirty: raw?.dirty !== false };
}
