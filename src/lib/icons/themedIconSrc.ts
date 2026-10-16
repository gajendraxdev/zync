import { CATEGORY_FALLBACK_MAP, getIconID, resolveIconResource } from './icon-map';
import { getCachedIcon } from './iconCache';
import { declaredIconId, type IconThemeDefinition } from './iconTheme';

export type ThemedIconEntry =
  | { status: 'loading' }
  | { status: 'ready'; src: string }
  | { status: 'missing' };

const entries = new Map<string, ThemedIconEntry>();
const inflight = new Map<string, Promise<ThemedIconEntry>>();
const listeners = new Map<string, Set<() => void>>();
const rejectedSrcs = new Map<string, Set<string>>();
// Keep one full v1 pack warm between mounts; live subscribers are never evicted.
const MAX_IDLE_ICON_ENTRIES = 512;
const idleEntries = new Map<string, true>();

function discardEntry(key: string) {
  idleEntries.delete(key);
  entries.delete(key);
  rejectedSrcs.delete(key);
  inflight.delete(key);
}

function retainIdleEntry(key: string) {
  if (listeners.has(key)) return;
  idleEntries.delete(key);
  idleEntries.set(key, true);
  while (idleEntries.size > MAX_IDLE_ICON_ENTRIES) {
    discardEntry(idleEntries.keys().next().value!);
  }
}

export function themedIconKey(
  theme: string,
  iconID: string,
  pluginId = '',
  pluginPath = '',
  pluginIconsPath = '',
  revision = '',
): string {
  return `${theme}\0${pluginId}\0${pluginPath}\0${pluginIconsPath}\0${iconID}\0${revision}`;
}

export function getThemedIconEntry(key: string): ThemedIconEntry | undefined {
  if (idleEntries.has(key)) retainIdleEntry(key);
  return entries.get(key);
}

export function subscribeThemedIcon(key: string, onChange: () => void): () => void {
  idleEntries.delete(key);
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onChange);
  return () => {
    set!.delete(onChange);
    if (set!.size === 0) {
      listeners.delete(key);
      if (entries.get(key)?.status === 'loading') discardEntry(key);
      else if (entries.has(key)) retainIdleEntry(key);
    }
  };
}

function notify(key: string) {
  const set = listeners.get(key);
  if (!set) return;
  for (const fn of set) fn();
}

async function loadThemedIconSrc(
  iconID: string,
  theme: string,
  pluginPath: string | undefined,
  pluginIconsPath: string | undefined,
  skip: Set<string>,
  definition?: IconThemeDefinition,
  revision = '',
): Promise<ThemedIconEntry> {
  let id = iconID;
  for (let level = 0; level < 4; level += 1) {
    const resource = resolveIconResource(id, theme, pluginPath, pluginIconsPath, definition);
    // Native asset URLs otherwise remain identical after a same-version local edit.
    const local = resource.local && revision && pluginPath && !pluginPath.startsWith('builtin://')
      ? `${resource.local}?zync-icon=${encodeURIComponent(revision)}` : resource.local;
    if (local && !skip.has(local)) {
      return { status: 'ready', src: local };
    }
    if (resource.remote) {
      const src = await getCachedIcon(resource.remote);
      if (src && !skip.has(src)) return { status: 'ready', src };
    }
    if (definition) break;
    const rawID = id.startsWith('file_type_') ? id.slice(10) : id;
    const category = CATEGORY_FALLBACK_MAP[rawID];
    if (!category) break;
    const nextId = `file_type_${category}`;
    if (nextId === id) break;
    id = nextId;
  }
  return { status: 'missing' };
}

export function ensureThemedIcon(
  key: string,
  iconID: string,
  theme: string,
  pluginPath?: string,
  pluginIconsPath?: string,
  definition?: IconThemeDefinition,
  revision = '',
): void {
  const current = entries.get(key);
  if (current?.status === 'ready' || current?.status === 'missing' || current?.status === 'loading') return;
  if (inflight.has(key)) return;

  entries.set(key, { status: 'loading' });
  const skip = rejectedSrcs.get(key) ?? new Set<string>();
  const work = loadThemedIconSrc(iconID, theme, pluginPath, pluginIconsPath, skip, definition, revision)
    .catch((): ThemedIconEntry => ({ status: 'missing' }))
    .then((entry) => {
      // A released or replaced request cannot repopulate a retired cache entry.
      if (inflight.get(key) !== work) return entry;
      entries.set(key, entry);
      retainIdleEntry(key);
      notify(key);
      return entry;
    })
    .finally(() => {
      if (inflight.get(key) === work) inflight.delete(key);
    });
  inflight.set(key, work);
}

export function markThemedIconMissing(key: string): void {
  const current = entries.get(key);
  if (current?.status === 'missing') return;
  entries.set(key, { status: 'missing' });
  retainIdleEntry(key);
  notify(key);
}

/** Browser failed to load `src`. Try the next candidate (remote, then CATEGORY_FALLBACK_MAP) before Lucide. */
export function reportThemedIconLoadError(
  key: string,
  iconID: string,
  theme: string,
  pluginPath?: string,
  pluginIconsPath?: string,
  definition?: IconThemeDefinition,
  revision = '',
): void {
  const entry = entries.get(key);
  if (!entry || entry.status === 'missing') return;
  const skip = rejectedSrcs.get(key) ?? new Set<string>();
  if (entry?.status === 'ready') skip.add(entry.src);
  rejectedSrcs.set(key, skip);
  idleEntries.delete(key);
  entries.delete(key);
  inflight.delete(key);
  ensureThemedIcon(key, iconID, theme, pluginPath, pluginIconsPath, definition, revision);
}

export function fileTypeIconID(type: string, isFolder: boolean, theme: string, definition?: IconThemeDefinition): string {
  if (definition) return declaredIconId(type, isFolder, definition);
  return isFolder ? `folder_type_${type}` : getIconID(type, theme);
}
