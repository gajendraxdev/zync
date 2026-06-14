export interface SyncDomainStatusLike {
  lastError?: string;
  lastErrorCode?: string;
  lastSync?: number;
}

export function formatSyncTime(value?: number): string {
  if (!value) return 'Never synced';
  return `Last sync ${new Date(value * 1000).toLocaleString()}`;
}

export function domainStatusCopy(status?: SyncDomainStatusLike): string {
  if (status?.lastError) {
    return `Error${status.lastErrorCode ? ` (${status.lastErrorCode})` : ''}: ${status.lastError}`;
  }
  return formatSyncTime(status?.lastSync);
}