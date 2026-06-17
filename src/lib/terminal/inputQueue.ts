const sessionQueues = new Map<string, Promise<void>>();
const sessionEpochs = new Map<string, number>();

function getEpoch(sessionId: string): number {
  return sessionEpochs.get(sessionId) ?? 0;
}

/** Bumps the queue epoch so in-flight tasks started before a clear/suspend are ignored. */
export function bumpTerminalInputQueueEpoch(sessionId: string): number {
  const next = getEpoch(sessionId) + 1;
  sessionEpochs.set(sessionId, next);
  return next;
}

/**
 * Serializes async terminal input handlers so ghost IPC cannot reorder PTY writes.
 */
export function enqueueTerminalInputTask(
  sessionId: string,
  task: () => Promise<void>,
): void {
  const epoch = getEpoch(sessionId);
  const previous = sessionQueues.get(sessionId) ?? Promise.resolve();
  const next = previous
    .then(async () => {
      if (getEpoch(sessionId) !== epoch) {
        return;
      }
      await task();
    })
    .catch((error) => {
      console.warn(`[terminal] Input task failed for ${sessionId}`, error);
    });
  sessionQueues.set(sessionId, next);
}

export function clearTerminalInputQueue(sessionId: string): void {
  bumpTerminalInputQueueEpoch(sessionId);
  sessionQueues.delete(sessionId);
}