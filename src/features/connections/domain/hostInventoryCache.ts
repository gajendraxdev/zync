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
  collectionId?: string;
  fetchedAt: number;
  hosts: SyncRemoteHostInventoryItem[];
}

const memoryByProvider = new Map<SyncProvider, CachedHostInventory>();

function storageKey(provider: SyncProvider): string {
  return `zync:host-inventory-cache:v1:${provider}`;
}

export function readHostInventoryCache(provider: SyncProvider): CachedHostInventory | null {
  const mem = memoryByProvider.get(provider);
  if (mem) return mem;

  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(storageKey(provider));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedHostInventory;
    if (!parsed || parsed.provider !== provider || !Array.isArray(parsed.hosts)) {
      return null;
    }
    memoryByProvider.set(provider, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export function writeHostInventoryCache(cache: CachedHostInventory): void {
  memoryByProvider.set(cache.provider, cache);
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(storageKey(cache.provider), JSON.stringify(cache));
  } catch {
    // Quota / private mode — memory still works for the session.
  }
}

/** Drop cache (e.g. provider disconnect, clear all connections). Lock should NOT call this. */
export function clearHostInventoryCache(provider: SyncProvider): void {
  memoryByProvider.delete(provider);
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(storageKey(provider));
  } catch {
    // ignore
  }
}

/** Clear every provider inventory cache (e.g. Clear all connections). */
export function clearAllHostInventoryCaches(): void {
  memoryByProvider.clear();
  if (typeof sessionStorage === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith('zync:host-inventory-cache:v1:')) keys.push(key);
    }
    for (const key of keys) sessionStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Fired when local connections are wiped — catalog should drop inventory UI until refresh. */
export const CONNECTIONS_CLEARED_EVENT = 'zync:connections-cleared';
