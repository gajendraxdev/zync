/** Machine-readable prefix returned when terminal:create runs before ssh_connect. */
export const TERMINAL_SPAWN_CONNECTION_NOT_READY = 'CONNECTION_NOT_READY:';

export function connectionNotReadyError(connectionId: string): string {
  return `${TERMINAL_SPAWN_CONNECTION_NOT_READY}${connectionId}`;
}

export function isTerminalSpawnConnectionNotReadyError(
  err: unknown,
  connectionId?: string,
): boolean {
  const message = String(err);
  if (!message.startsWith(TERMINAL_SPAWN_CONNECTION_NOT_READY)) {
    return false;
  }
  if (!connectionId) {
    return true;
  }
  return message === connectionNotReadyError(connectionId);
}

/** User-facing message for terminal spawn failures. */
export function formatTerminalSpawnError(err: unknown): string {
  if (isTerminalSpawnConnectionNotReadyError(err)) {
    return 'SSH connection is not ready. Reconnect to the host, then press Enter to restart the terminal.';
  }
  return String(err);
}