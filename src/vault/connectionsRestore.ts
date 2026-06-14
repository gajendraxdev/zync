import type {
  SyncConnectionsRestoreArgs,
  SyncConnectionsRestoreResult,
} from './syncIpc';
import type { ToastType } from '../store/toastSlice';

export function normalizeConnectionsRestoreArgs(
  args: SyncConnectionsRestoreArgs = {},
): SyncConnectionsRestoreArgs {
  const hostLogicalIds = args.hostLogicalIds
    ?.map(id => id.trim())
    .filter(id => id.length > 0);

  return {
    includeHostDefinitions: args.includeHostDefinitions ?? true,
    includeTunnels: args.includeTunnels ?? true,
    includeHostSnippets: args.includeHostSnippets ?? true,
    includeReferencedCredentials: args.includeReferencedCredentials ?? true,
    hostLogicalIds: hostLogicalIds && hostLogicalIds.length > 0 ? hostLogicalIds : undefined,
  };
}

export function formatConnectionsRestoreSuccessMessage(
  result: SyncConnectionsRestoreResult,
): string {
  const hostChanged = result.hosts.restored + result.hosts.updated;
  const credentialChanged =
    result.hosts.credentialsRestored + result.hosts.credentialsUpdated;
  const tunnelChanged = (result.tunnels?.restored ?? 0) + (result.tunnels?.updated ?? 0);
  const snippetChanged =
    (result.hostSnippets?.restored ?? 0) + (result.hostSnippets?.updated ?? 0);

  if (hostChanged + tunnelChanged + snippetChanged === 0) {
    return 'No connection changes restored from Google.';
  }

  const parts = [`${hostChanged} host${hostChanged === 1 ? '' : 's'}`];
  if (credentialChanged > 0) {
    parts.push(`${credentialChanged} credential${credentialChanged === 1 ? '' : 's'}`);
  }
  if (tunnelChanged > 0) {
    parts.push(`${tunnelChanged} tunnel${tunnelChanged === 1 ? '' : 's'}`);
  }
  if (snippetChanged > 0) {
    parts.push(`${snippetChanged} host snippet${snippetChanged === 1 ? '' : 's'}`);
  }

  return `Restored connections from Google (${parts.join('; ')}).`;
}

export function reportConnectionsRestoreWarnings(
  result: SyncConnectionsRestoreResult,
  showToast: (type: ToastType, message: string) => void,
): void {
  if (result.hosts.failed > 0) {
    showToast('error', `${result.hosts.failed} host record(s) failed to parse/decrypt.`);
  }
  if (result.hosts.credentialsFailed > 0 || result.hosts.credentialsConflicts > 0) {
    showToast(
      'error',
      `${result.hosts.credentialsFailed + result.hosts.credentialsConflicts} referenced credential record(s) need attention before some hosts can connect.`,
    );
  }
  const orphaned =
    (result.tunnels?.skippedOrphaned ?? 0) + (result.hostSnippets?.skippedOrphaned ?? 0);
  if (orphaned > 0) {
    showToast(
      'info',
      `Skipped ${orphaned} tunnel/snippet record(s) that did not match restored hosts.`,
    );
  }
}

