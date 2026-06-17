/** Tracks which SSH hosts have a live entry in the Tauri connections map. */

const liveEpochByConnection: Record<string, number> = {};

export function markConnectionBackendLive(connectionId: string): number {
  liveEpochByConnection[connectionId] = (liveEpochByConnection[connectionId] ?? 0) + 1;
  return liveEpochByConnection[connectionId];
}

export function markConnectionBackendOffline(connectionId: string): void {
  delete liveEpochByConnection[connectionId];
}

export function isConnectionBackendLive(connectionId: string): boolean {
  return (liveEpochByConnection[connectionId] ?? 0) > 0;
}