import type { Connection } from './types';
import type { SyncProvider, SyncRemoteHostInventoryItem } from '../../../vault/syncIpc';

/** Location chips shown on a host row. Extensible when more providers ship. */
export type HostLocationTag = 'local' | SyncProvider;

/** List filters: Remote = any non-local provider location (Google, Git, …). */
export type HostCatalogFilter = 'all' | 'local' | 'remote';

export interface HostProviderLocation {
  provider: SyncProvider;
  collectionId?: string;
  revision?: number;
  updatedAt?: number;
  hasAuthRef?: boolean;
  credentialId?: string;
}

/**
 * Unified multi-location host row.
 * One entry per logicalId; locations describe where the host exists.
 */
export interface HostCatalogEntry {
  logicalId: string;
  name: string;
  host: string;
  port: number;
  username: string;
  folder?: string;
  tags: string[];
  isFavorite: boolean;
  locations: HostLocationTag[];
  /** Present when materialized on this device. */
  local?: Connection;
  providers: HostProviderLocation[];
}

export function connectionLogicalId(
  conn: Pick<Connection, 'id' | 'username' | 'host' | 'port'>,
): string {
  const id = conn.id?.trim();
  if (id) return id;
  return `${(conn.username ?? '').trim().toLowerCase()}@${(conn.host ?? '').trim().toLowerCase()}:${conn.port ?? 22}`;
}

export function isLocalShellConnection(conn: Pick<Connection, 'id'>): boolean {
  return conn.id === 'local';
}

/**
 * Merge local working-set connections with provider inventory by logicalId.
 * Local display fields win when both exist (local-first).
 * Unknown future inventory fields are not required — additive merge only.
 */
export function mergeHostCatalog(
  connections: Connection[],
  inventory: SyncRemoteHostInventoryItem[] = [],
): HostCatalogEntry[] {
  const byId = new Map<string, HostCatalogEntry>();

  for (const conn of connections) {
    if (isLocalShellConnection(conn)) continue;
    const logicalId = connectionLogicalId(conn);
    byId.set(logicalId, {
      logicalId,
      name: conn.name || conn.host,
      host: conn.host,
      port: conn.port,
      username: conn.username,
      folder: conn.folder,
      tags: conn.tags ?? [],
      isFavorite: Boolean(conn.isFavorite),
      locations: ['local'],
      local: conn,
      providers: [],
    });
  }

  for (const remote of inventory) {
    const logicalId = remote.logicalId?.trim();
    if (!logicalId) continue;

    const providerLoc: HostProviderLocation = {
      provider: remote.provider,
      collectionId: remote.collectionId,
      revision: remote.revision,
      updatedAt: remote.updatedAt,
      hasAuthRef: remote.hasAuthRef,
      credentialId: remote.credentialId,
    };

    const existing = byId.get(logicalId);
    if (existing) {
      if (!existing.locations.includes(remote.provider)) {
        existing.locations = [...existing.locations, remote.provider];
      }
      const already = existing.providers.some(p => p.provider === remote.provider);
      if (!already) {
        existing.providers = [...existing.providers, providerLoc];
      }
      continue;
    }

    byId.set(logicalId, {
      logicalId,
      name: remote.name || remote.host,
      host: remote.host,
      port: remote.port,
      username: remote.username,
      folder: remote.folder,
      tags: remote.tags ?? [],
      isFavorite: Boolean(remote.isFavorite),
      locations: [remote.provider],
      providers: [providerLoc],
    });
  }

  return Array.from(byId.values()).sort((a, b) => {
    const an = (a.name || a.host).toLowerCase();
    const bn = (b.name || b.host).toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return a.logicalId.localeCompare(b.logicalId);
  });
}

export function filterHostCatalog(
  entries: HostCatalogEntry[],
  filter: HostCatalogFilter,
): HostCatalogEntry[] {
  if (filter === 'all') return entries;
  if (filter === 'local') {
    return entries.filter(e => e.locations.includes('local'));
  }
  // remote: present on any provider (google / git / …), with or without local
  return entries.filter(e => e.locations.some(loc => loc !== 'local'));
}

export function searchHostCatalog(
  entries: HostCatalogEntry[],
  searchTerm: string,
): HostCatalogEntry[] {
  const q = searchTerm.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(e => {
    return (
      e.name.toLowerCase().includes(q) ||
      e.host.toLowerCase().includes(q) ||
      e.username.toLowerCase().includes(q) ||
      e.logicalId.toLowerCase().includes(q) ||
      e.tags.some(t => t.toLowerCase().includes(q)) ||
      (e.folder ?? '').toLowerCase().includes(q)
    );
  });
}

export function catalogEntryHasLocal(entry: HostCatalogEntry): boolean {
  return Boolean(entry.local) || entry.locations.includes('local');
}

export function catalogLocationsByLogicalId(
  entries: HostCatalogEntry[],
): Map<string, HostLocationTag[]> {
  const map = new Map<string, HostLocationTag[]>();
  for (const entry of entries) {
    map.set(entry.logicalId, entry.locations);
  }
  return map;
}

/** Local connections included in the current catalog filter (for existing tree UI). */
export function localConnectionsFromCatalog(entries: HostCatalogEntry[]): Connection[] {
  return entries
    .map(e => e.local)
    .filter((c): c is Connection => Boolean(c));
}

/** Provider-only rows (not yet on this device). */
export function remoteOnlyCatalogEntries(entries: HostCatalogEntry[]): HostCatalogEntry[] {
  return entries.filter(e => !catalogEntryHasLocal(e));
}
