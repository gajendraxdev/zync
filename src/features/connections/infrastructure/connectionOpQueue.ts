/** Serializes connect/disconnect per host so reconnect cannot race ahead of disconnect. */

const opChains = new Map<string, Promise<unknown>>();

export function runSerializedConnectionOp<T>(
  connectionId: string,
  op: () => Promise<T>,
): Promise<T> {
  if (connectionId === 'local') {
    return op();
  }

  const previous = opChains.get(connectionId) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(() => op());

  const settled = next.then(
    () => undefined,
    () => undefined,
  );
  opChains.set(connectionId, settled);

  // Cleanup entry once this op settles (if no newer op has overwritten the map entry).
  settled.finally(() => {
    if (opChains.get(connectionId) === settled) {
      opChains.delete(connectionId);
    }
  }).catch(() => {});

  return next;
}