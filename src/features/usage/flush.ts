import { resolveAppVersion, resolveSurveyArch, resolveSurveyPlatform } from '../survey/platform.js';
import { isUsageFeatureId } from './catalog.js';
import { submitUsage } from './client.js';
import { isUsageEnabled } from './enabled.js';
import { getOrCreateInstallId } from '../installation/identity.js';
import { fitUsagePayload } from './payload.js';
import {
  checkpointUsage,
  dropPendingDay,
  loadQueue,
  markCurrentFlushed,
  saveQueue,
  type UsageDayQueue,
  type UsageQueueState,
} from './queue.js';
import type { UsageApiResult, UsagePayload } from './types.js';

const FLUSH_INTERVAL_MS = 15 * 60 * 1000;

let cachedVersion = '';

async function toPayload(day: UsageDayQueue): Promise<UsagePayload> {
  if (!cachedVersion) {
    cachedVersion = await resolveAppVersion();
  }
  const features = Object.entries(day.features).flatMap(([id, count]) => {
    if (!isUsageFeatureId(id) || !count) return [];
    return [{ id, count }];
  });
  return fitUsagePayload({
    schemaVersion: 1,
    installId: getOrCreateInstallId(),
    day: day.day,
    appVersion: cachedVersion || undefined,
    platform: resolveSurveyPlatform(),
    arch: resolveSurveyArch(),
    openSeconds: day.openSeconds,
    features,
    sessions: day.sessions,
  });
}

export interface UsageFlushDependencies {
  isEnabled: () => boolean;
  now: () => Date;
  load: (now?: Date) => UsageQueueState;
  save: (state: UsageQueueState) => void;
  submit: (payload: UsagePayload) => Promise<UsageApiResult>;
  makePayload: (day: UsageDayQueue) => Promise<UsagePayload>;
}

export function createUsageFlusher(dependencies: UsageFlushDependencies) {
  let activeFlush: Promise<void> | null = null;
  let forceRequested = false;

  const checkpoint = (): UsageQueueState => {
    const now = dependencies.now();
    const state = checkpointUsage(dependencies.load(now), now);
    dependencies.save(state);
    return state;
  };

  const flushOnce = async (forceCurrent: boolean): Promise<void> => {
    try {
      const attemptedPendingDays = new Set<string>();

      while (dependencies.isEnabled()) {
        const snapshot = checkpoint();
        const pending = snapshot.pending.find(
          (day) => day.dirty && !attemptedPendingDays.has(day.day),
        );
        if (!pending) break;

        attemptedPendingDays.add(pending.day);
        await dependencies.submit(await dependencies.makePayload(pending));
        const now = dependencies.now();
        dependencies.save(dropPendingDay(dependencies.load(now), pending.day, now.getTime()));
      }

      if (!dependencies.isEnabled()) return;
      const snapshot = checkpoint();
      const due = forceCurrent
        || snapshot.current.dirty
        || snapshot.lastFlushAt == null
        || (dependencies.now().getTime() - snapshot.lastFlushAt) >= FLUSH_INTERVAL_MS;
      if (!due) return;

      const sent = snapshot.current;
      await dependencies.submit(await dependencies.makePayload(sent));
      if (!dependencies.isEnabled()) return;
      const now = dependencies.now();
      dependencies.save(markCurrentFlushed(dependencies.load(now), sent, now.getTime()));
    } catch {
      // The checkpoint remains dirty and will be retried on the next trigger.
    }
  };

  return (forceCurrent = false): Promise<void> => {
    if (!dependencies.isEnabled()) return Promise.resolve();
    if (forceCurrent) {
      forceRequested = true;
      // Closing cannot wait indefinitely for an in-flight request. Persist the
      // latest timing synchronously so a restart can retry it even if shutdown
      // wins the network race.
      checkpoint();
    }
    if (activeFlush) return activeFlush;

    activeFlush = (async () => {
      let firstRun = true;
      try {
        while (dependencies.isEnabled() && (firstRun || forceRequested)) {
          const forceThisRun = forceRequested;
          forceRequested = false;
          firstRun = false;
          await flushOnce(forceThisRun);
        }
      } finally {
        activeFlush = null;
        if (!dependencies.isEnabled()) forceRequested = false;
      }
    })();

    return activeFlush;
  };
}

const flushUsage = createUsageFlusher({
  isEnabled: isUsageEnabled,
  now: () => new Date(),
  load: loadQueue,
  save: saveQueue,
  submit: submitUsage,
  makePayload: toPayload,
});

export { FLUSH_INTERVAL_MS, flushUsage };
