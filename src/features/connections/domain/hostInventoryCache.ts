import type { SyncProvider, SyncRemoteHostInventoryItem } from '../../../vault/syncIpc';

/**
 * Last-known provider host inventory cache.
 *
 * Once inventory is successfully listed (collection unlocked), we remember
 * which logical hosts belong to that provider. Locking the collection key
 * must NOT wipe this knowledge — chips and filters stay useful offline/locked.
 *
 * This is metadata only (no secrets). Re-fetch when unlocked refreshes freshness.
 */

export interface CachedHostInventory {
  provider: SyncProvider;
  /** Stable account identity (e.g. Google email). Scopes cache per signed-in account. */
  accountKey?: string;
  collectionId?: string;
  fetchedAt: number;
  hosts: SyncRemoteHostInventoryItem[];
}

/** Memory key: provider + optional account so account switches do not share inventory. */
type CacheBucketKey = string;

const memoryByBucket = new Map<CacheBucketKey, CachedHostInventory>();

function normalizeAccountKey(accountKey?: string | null): string {
  const trimmed = (accountKey ?? '').trim().toLowerCase();
  return trimmed || '_default';
}

function bucketKey(provider: SyncProvider, accountKey?: string | null): CacheBucketKey {
  return `${provider}::${normalizeAccountKey(accountKey)}`;
}

function storageKey(provider: SyncProvider, accountKey?: string | null): string {
  return `zync:host-inventory-cache:v2:${provider}:${normalizeAccountKey(accountKey)}`;
}

export function readHostInventoryCache(
  provider: SyncProvider,
  accountKey?: string | null,
): CachedHostInventory | null {
  const bucket = bucketKey(provider, accountKey);
  const mem = memoryByBucket.get(bucket);
  if (mem) return mem;

  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(provider, accountKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedHostInventory;
    if (!parsed || parsed.provider !== provider || !Array.isArray(parsed.hosts)) {
      return null;
    }
    const expectedAccount = normalizeAccountKey(accountKey);
    const cachedAccount = normalizeAccountKey(parsed.accountKey);
    if (cachedAccount !== expectedAccount) {
      return null;
    }
    memoryByBucket.set(bucket, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeHostInventoryCache(cache: CachedHostInventory): void {
  const accountKey = cache.accountKey;
  const bucket = bucketKey(cache.provider, accountKey);
  const toStore: CachedHostInventory = {
    ...cache,
    accountKey: normalizeAccountKey(accountKey) === '_default' ? undefined : normalizeAccountKey(accountKey),
  };
  memoryByBucket.set(bucket, toStore);
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(cache.provider, accountKey), JSON.stringify(toStore));
  } catch {
    // Quota / private mode — memory still works for the session.
  }
}

/** Drop cache for one provider (all accounts). Lock should NOT call this. */
export function clearHostInventoryCache(provider: SyncProvider): void {
  for (const key of [...memoryByBucket.keys()]) {
    if (key.startsWith(`${provider}::`)) memoryByBucket.delete(key);
  }
  if (typeof sessionStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (
        key?.startsWith(`zync:host-inventory-cache:v2:${provider}:`)
        || key === `zync:host-inventory-cache:v1:${provider}`
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Clear every provider inventory cache (e.g. Clear all connections). */
export function clearAllHostInventoryCaches(): void {
  memoryByBucket.clear();
  if (typeof sessionStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (
        key?.startsWith('zync:host-inventory-cache:v2:')
        || key?.startsWith('zync:host-inventory-cache:v1:')
      ) {
        keys.push(key);
      }
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Fired when local connections are wiped — catalog should drop inventory UI until refresh. */
export const CONNECTIONS_CLEARED_EVENT = 'zync:connections-cleared';
