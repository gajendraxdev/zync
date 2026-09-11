import { CATEGORY_FALLBACK_MAP, getIconID, resolveIconResource } from './icon-map';
import { getCachedIcon } from './iconCache';

export type ThemedIconEntry =
  | { status: 'loading' }
  | { status: 'ready'; src: string }
  | { status: 'missing' };

const entries = new Map<string, ThemedIconEntry>();
const inflight = new Map<string, Promise<ThemedIconEntry>>();
const listeners = new Map<string, Set<() => void>>();

export function themedIconKey(
  theme: string,
  iconID: string,
  pluginId = '',
  pluginPath = '',
  pluginIconsPath = '',
): string {
  return `${theme}\0${pluginId}\0${pluginPath}\0${pluginIconsPath}\0${iconID}`;
}

export function getThemedIconEntry(key: string): ThemedIconEntry | undefined {
  return entries.get(key);
}

export function subscribeThemedIcon(key: string, onChange: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(onChange);
  return () => {
    set!.delete(onChange);
    if (set!.size === 0) listeners.delete(key);
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
  pluginPath?: string,
  pluginIconsPath?: string,
): Promise<ThemedIconEntry> {
  let id = iconID;
  for (let level = 0; level < 2; level += 1) {
    const resource = resolveIconResource(id, theme, pluginPath, pluginIconsPath);
    if (resource.local) return { status: 'ready', src: resource.local };
    if (resource.remote) {
      const src = await getCachedIcon(resource.remote);
      if (src) return { status: 'ready', src };
    }
    const rawID = id.startsWith('file_type_') ? id.slice(10) : id;
    const category = CATEGORY_FALLBACK_MAP[rawID];
    if (!category) break;
    id = `file_type_${category}`;
  }
  return { status: 'missing' };
}

export function ensureThemedIcon(
  key: string,
  iconID: string,
  theme: string,
  pluginPath?: string,
  pluginIconsPath?: string,
): void {
  const current = entries.get(key);
  if (current?.status === 'ready' || current?.status === 'missing' || current?.status === 'loading') return;
  if (inflight.has(key)) return;

  entries.set(key, { status: 'loading' });
  const work = loadThemedIconSrc(iconID, theme, pluginPath, pluginIconsPath)
    .catch((): ThemedIconEntry => ({ status: 'missing' }))
    .then((entry) => {
      entries.set(key, entry);
      notify(key);
      return entry;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, work);
}

export function markThemedIconMissing(key: string): void {
  const current = entries.get(key);
  if (current?.status === 'missing') return;
  entries.set(key, { status: 'missing' });
  notify(key);
}

export function fileTypeIconID(type: string, isFolder: boolean, theme: string): string {
  return isFolder ? `folder_type_${type}` : getIconID(type, theme);
}
