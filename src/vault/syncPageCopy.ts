import type { SyncCollectionStatus, SyncProviderStatus } from './syncIpc';
import { getProviderReadiness } from './syncProviderGate';

/** Plain-language status for the Sync & Backup page header — no internal jargon. */
export function getSyncBackupPageStatusMessage(
  googleSync: SyncProviderStatus | null,
  googleCollection: SyncCollectionStatus | null,
): string {
  const readiness = getProviderReadiness(googleSync, googleCollection);

  if (!readiness.isConnected) {
    return 'Connect Google Drive below to back up hosts, tunnels, snippets, settings, and credentials across your devices.';
  }
  if (!readiness.isEncryptionConfigured) {
    return 'Google Drive is connected. Set up your sync passphrase next — nothing uploads until you do.';
  }
  if (!readiness.isEncryptionUnlocked) {
    return 'Google Drive is connected. Unlock your sync passphrase on this device before you upload or restore.';
  }

  const email = googleSync?.email?.trim();
  const accountLine = email ? `Signed in as ${email}.` : 'Google Drive is connected.';
  return `${accountLine} You can upload or restore whenever you want — nothing syncs automatically yet.`;
}