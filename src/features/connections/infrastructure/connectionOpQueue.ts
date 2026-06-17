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

  opChains.set(
    connectionId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );

  return next;
}