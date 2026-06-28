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

function isHostUnreachableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('unreachable host')
    || lower.includes('network is unreachable')
    || lower.includes('no route to host')
    || lower.includes('os error 10065')
    || lower.includes('os error 10051')
    || lower.includes('os error 10060')
    || lower.includes('timed out')
    || lower.includes('connection refused')
    || lower.includes('connection reset')
    || lower.includes('name or service not known')
    || lower.includes('failed to lookup address')
    || (lower.includes('failed to connect') && (
      lower.includes('unreachable')
      || lower.includes('timeout')
      || lower.includes('refused')
      || lower.includes('10065')
      || lower.includes('10051')
      || lower.includes('10060')
    ))
  );
}

/** User-facing message for terminal spawn failures. */
export function formatTerminalSpawnError(err: unknown): string {
  const message = String(err);

  if (isTerminalSpawnConnectionNotReadyError(err)) {
    return 'SSH connection is not ready. Reconnect to the host, then press Enter to restart the terminal.';
  }

  if (isHostUnreachableError(message)) {
    return 'Cannot reach the host. Check your internet connection or VPN, reconnect to the server, then press Enter to restart the terminal.';
  }

  return message;
}