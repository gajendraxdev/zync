import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Connection } from '../domain/types';
import {
  filterHostCatalog,
  mergeHostCatalog,
  remoteOnlyCatalogEntries,
  searchHostCatalog,
  type HostCatalogEntry,
  type HostCatalogFilter,
  type HostLocationTag,
  catalogLocationsByLogicalId,
  localConnectionsFromCatalog,
} from '../domain/hostCatalog';
import {
  clearAllHostInventoryCaches,
  clearHostInventoryCache,
  CONNECTIONS_CLEARED_EVENT,
  readHostInventoryCache,
  writeHostInventoryCache,
} from '../domain/hostInventoryCache';
import {
  SYNC_STATUS_CHANGED_EVENT,
  syncIpc,
  type SyncProvider,
  type SyncRemoteHostInventoryItem,
} from '../../../vault/syncIpc';
import {
  ensureSyncReadinessListener,
  useSyncReadinessStore,
} from '../../../vault/useSyncReadinessStore';

export type HostInventoryStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | /** Live fetch succeeded this session window. */
  'cached'
  | 'unavailable'
  | 'not_configured'
  | 'locked'
  | 'error';

export interface UseHostCatalogResult {
  filter: HostCatalogFilter;
  setFilter: (filter: HostCatalogFilter) => void;
  entries: HostCatalogEntry[];
  filteredEntries: HostCatalogEntry[];
  localConnections: Connection[];
  remoteOnlyEntries: HostCatalogEntry[];
  locationsByLogicalId: Map<string, HostLocationTag[]>;
  inventoryStatus: HostInventoryStatus;
  /** True when rows include last-known provider data that may be stale. */
  inventoryFromCache: boolean;
  inventoryError?: string;
  /** Last inventory scan stats (for empty-state diagnostics). */
  lastInventoryScan?: { scanned: number; failed: number; skipped: number };
  /** Provider OAuth connected (filters/refresh only make sense when true). */
  providerConnected: boolean;
  providerReady: boolean;
  refreshInventory: () => Promise<void>;
  materializingIds: Set<string>;
  setMaterializing: (logicalId: string, active: boolean) => void;
}

const PRIMARY_PROVIDER: SyncProvider = 'google';

function currentAccountKey(): string | undefined {
  const email = useSyncReadinessStore.getState().oauth?.email?.trim();
  return email || undefined;
}

function hostsFromCache(
  provider: SyncProvider,
  accountKey?: string | null,
): SyncRemoteHostInventoryItem[] {
  return readHostInventoryCache(provider, accountKey)?.hosts ?? [];
}

/**
 * Loads provider host inventory (when available) and merges with local connections.
 *
 * Location membership is remembered after the first successful list:
 * locking the collection does not clear [google] chips or provider-only rows.
 * Unlock + refresh re-fetches for freshness; lock alone does not require a re-list
 * to know a host still belongs to Google.
 */
export function useHostCatalog(
  connections: Connection[],
  searchTerm: string,
): UseHostCatalogResult {
  useEffect(() => {
    ensureSyncReadinessListener();
  }, []);

  // Shared with Sync & Backup — never re-derive OAuth / encryption separately.
  const readiness = useSyncReadinessStore(s => s.readiness);
  const accountEmail = useSyncReadinessStore(s => s.oauth?.email);
  const refreshReadiness = useSyncReadinessStore(s => s.refresh);
  const providerConnected = readiness.isConnected;
  const providerReady = readiness.isProviderReady;

  const [filter, setFilterState] = useState<HostCatalogFilter>('all');
  const [inventory, setInventory] = useState<SyncRemoteHostInventoryItem[]>(() =>
    hostsFromCache(PRIMARY_PROVIDER, currentAccountKey()),
  );
  const [inventoryStatus, setInventoryStatus] = useState<HostInventoryStatus>(() =>
    hostsFromCache(PRIMARY_PROVIDER, currentAccountKey()).length > 0 ? 'cached' : 'idle',
  );
  const [inventoryFromCache, setInventoryFromCache] = useState(
    () => hostsFromCache(PRIMARY_PROVIDER, currentAccountKey()).length > 0,
  );
  const [inventoryError, setInventoryError] = useState<string | undefined>();
  const [lastInventoryScan, setLastInventoryScan] = useState<
    { scanned: number; failed: number; skipped: number } | undefined
  >();
  const [materializingIds, setMaterializingIds] = useState<Set<string>>(() => new Set());

  const setMaterializing = useCallback((logicalId: string, active: boolean) => {
    setMaterializingIds(prev => {
      const next = new Set(prev);
      if (active) next.add(logicalId);
      else next.delete(logicalId);
      return next;
    });
  }, []);

  const applyCachedInventory = useCallback((
    status: HostInventoryStatus,
    accountKey?: string | null,
  ) => {
    const cached = hostsFromCache(PRIMARY_PROVIDER, accountKey);
    if (cached.length > 0) {
      setInventory(cached);
      setInventoryFromCache(true);
      setInventoryStatus(status);
      return true;
    }
    setInventoryFromCache(false);
    setInventoryStatus(status);
    return false;
  }, []);

  const refreshInventory = useCallback(async () => {
    setInventoryError(undefined);
    try {
      // One readiness refresh — same store Sync & Backup uses.
      await refreshReadiness(PRIMARY_PROVIDER);
      const { readiness: next, oauth } = useSyncReadinessStore.getState();
      const accountKey = oauth?.email?.trim() || undefined;

      if (!next.isConnected) {
        // Drop provider inventory so a previous Google account cannot linger.
        clearHostInventoryCache(PRIMARY_PROVIDER);
        setInventory([]);
        setInventoryFromCache(false);
        setInventoryStatus('unavailable');
        return;
      }

      // Only show full loading when we have nothing for this account yet.
      if (hostsFromCache(PRIMARY_PROVIDER, accountKey).length === 0) {
        setInventoryStatus('loading');
      }

      if (!next.isEncryptionConfigured) {
        if (!applyCachedInventory('not_configured', accountKey)) {
          setInventory([]);
          setInventoryStatus('not_configured');
        }
        return;
      }

      // Locked: do NOT clear inventory and do NOT re-fetch encrypted objects.
      if (!next.isEncryptionUnlocked) {
        if (!applyCachedInventory('locked', accountKey)) {
          setInventory([]);
          setInventoryStatus('locked');
        }
        return;
      }

      // Unlocked: live refresh
      const result = await syncIpc.hostsRemoteInventory(PRIMARY_PROVIDER);
      const hosts = result.hosts ?? [];
      const scanned = result.scanned ?? 0;
      const failed = result.failed ?? 0;
      const skipped = result.skipped ?? 0;
      setLastInventoryScan({ scanned, failed, skipped });

      // Drive had host objects but none decrypted — almost always wrong passphrase
      // for the selected collection (e.g. new key after local reset).
      if (hosts.length === 0 && failed > 0) {
        setInventory([]);
        setInventoryFromCache(false);
        setInventoryStatus('error');
        setInventoryError(
          `Found ${scanned} host file(s) on Drive but could not decrypt ${failed}. ` +
            'The collection key on this device does not match the key that encrypted those files. ' +
            'Using the same passphrase after a full local reset is not enough if the key was regenerated. ' +
            'Fix: in Sync & Backup, remove this broken link and either recover from a machine that still has the key, ' +
            'or start a new empty collection and re-upload hosts.',
        );
        return;
      }

      setInventory(hosts);
      setInventoryFromCache(false);
      setInventoryStatus('ready');
      writeHostInventoryCache({
        provider: PRIMARY_PROVIDER,
        accountKey,
        collectionId: result.collectionId,
        fetchedAt: Date.now(),
        hosts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInventoryError(message);
      // Keep OAuth "connected" UI; inventory failure is not a disconnect.
      // Keep last-known locations on error instead of wiping chips.
      if (!applyCachedInventory('error', currentAccountKey())) {
        setInventory([]);
        setInventoryStatus('error');
      }
    }
  }, [applyCachedInventory, refreshReadiness]);

  // Account switch: re-bind inventory to the signed-in identity.
  useEffect(() => {
    if (!providerConnected) return;
    const accountKey = accountEmail?.trim() || undefined;
    const cached = hostsFromCache(PRIMARY_PROVIDER, accountKey);
    if (cached.length > 0 && inventoryStatus !== 'ready') {
      setInventory(cached);
      setInventoryFromCache(true);
      setInventoryStatus(prev => (prev === 'idle' ? 'cached' : prev));
    }
  }, [accountEmail, inventoryStatus, providerConnected]);

  useEffect(() => {
    void refreshInventory();
  }, [refreshInventory]);

  useEffect(() => {
    const onSyncStatus = (event: Event) => {
      const detail = (event as CustomEvent<{ provider?: string }>).detail;
      if (detail?.provider && detail.provider !== PRIMARY_PROVIDER) return;
      // Readiness store also refreshes on this event; inventory re-gates off shared state.
      void refreshInventory();
    };
    window.addEventListener(SYNC_STATUS_CHANGED_EVENT, onSyncStatus as EventListener);
    return () => {
      window.removeEventListener(SYNC_STATUS_CHANGED_EVENT, onSyncStatus as EventListener);
    };
  }, [refreshInventory]);

  /**
   * Selecting Remote re-checks readiness + inventory via the shared store.
   */
  const setFilter = useCallback((next: HostCatalogFilter) => {
    setFilterState(next);
    if (next === 'remote') {
      void refreshInventory();
    }
  }, [refreshInventory]);

  // Clear all connections: drop provider inventory from UI until user refreshes.
  // (Do not auto re-fetch here — otherwise Google rows instantly reappear.)
  useEffect(() => {
    const onConnectionsCleared = () => {
      clearAllHostInventoryCaches();
      setInventory([]);
      setInventoryFromCache(false);
      setInventoryStatus('idle');
      setInventoryError(undefined);
    };
    window.addEventListener(CONNECTIONS_CLEARED_EVENT, onConnectionsCleared);
    return () => {
      window.removeEventListener(CONNECTIONS_CLEARED_EVENT, onConnectionsCleared);
    };
  }, []);

  const entries = useMemo(
    () => mergeHostCatalog(connections, inventory),
    [connections, inventory],
  );

  const filteredEntries = useMemo(() => {
    const byFilter = filterHostCatalog(entries, filter);
    return searchHostCatalog(byFilter, searchTerm);
  }, [entries, filter, searchTerm]);

  const localConnections = useMemo(
    () => localConnectionsFromCatalog(filteredEntries),
    [filteredEntries],
  );

  const remoteOnlyEntries = useMemo(
    () => remoteOnlyCatalogEntries(filteredEntries),
    [filteredEntries],
  );

  const locationsByLogicalId = useMemo(
    () => catalogLocationsByLogicalId(entries),
    [entries],
  );

  return {
    filter,
    setFilter,
    entries,
    filteredEntries,
    localConnections,
    remoteOnlyEntries,
    locationsByLogicalId,
    inventoryStatus,
    inventoryFromCache,
    inventoryError,
    lastInventoryScan,
    providerConnected,
    providerReady,
    refreshInventory,
    materializingIds,
    setMaterializing,
  };
}
