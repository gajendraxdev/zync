import { filePathSeparator, normalizeFilePath } from './filePathNav';

function volumePathKey(path: string): string {
  const normalized = normalizeFilePath(path);
  return filePathSeparator(normalized) === '\\' ? normalized.toLowerCase() : normalized;
}

function volumePathsEqual(a: string, b: string): boolean {
  return volumePathKey(a) === volumePathKey(b);
}

function volumePathUnder(path: string, ancestor: string): boolean {
  if (!ancestor) return false;
  const current = volumePathKey(path);
  const root = volumePathKey(ancestor);
  if (current === root) return true;
  if (root === '/') return current.startsWith('/');
  const sep = root.includes('\\') ? '\\' : '/';
  const prefix = root.endsWith('\\') || root.endsWith('/') ? root : `${root}${sep}`;
  return current.startsWith(prefix);
}

export type FileVolumeKind = 'fixed' | 'removable' | 'optical' | 'network' | 'linux' | 'other';

export interface FileVolume {
  id: string;
  path: string;
  label: string;
  letter?: string;
  kind: FileVolumeKind;
  freeBytes?: number;
  totalBytes?: number;
}

export function fileVolumesSectionTitle(platform = typeof navigator !== 'undefined' ? navigator.platform : ''): string {
  const value = platform.toLowerCase();
  if (value === 'win32' || value.startsWith('win')) return 'This PC';
  if (value === 'darwin' || value.includes('mac')) return 'Volumes';
  return 'Other Locations';
}

export function fileVolumeDisplayLabel(volume: FileVolume): string {
  const letter = volume.letter?.replace(/[\\/]+$/, '') || '';
  if (letter) {
    const fallback = volume.kind === 'fixed'
      ? 'Local Disk'
      : volume.kind === 'removable'
        ? 'Removable Disk'
        : volume.kind === 'optical'
          ? 'DVD Drive'
          : '';
    const name = volume.label.trim() || fallback;
    return name ? `${name} (${letter})` : letter;
  }
  return volume.label.trim() || volume.path;
}

export function isPathInHome(currentPath: string, homePath: string): boolean {
  const home = normalizeFilePath(homePath);
  if (!home) return false;
  return volumePathsEqual(currentPath, home) || volumePathUnder(currentPath, home);
}

/** Longest volume prefix. While browsing Home, skip the disk Home lives on so Home and C: stay distinct. */
export function matchingVolumePath(
  currentPath: string,
  volumes: FileVolume[],
  homePath = '',
): string | null {
  const home = homePath ? normalizeFilePath(homePath) : '';
  const inHome = Boolean(home) && isPathInHome(currentPath, home);
  let best: string | null = null;
  let bestLen = -1;
  for (const volume of volumes) {
    const path = normalizeFilePath(volume.path);
    if (!volumePathsEqual(currentPath, path) && !volumePathUnder(currentPath, path)) continue;
    if (inHome && home && (volumePathsEqual(path, home) || volumePathUnder(home, path))) continue;
    if (path.length > bestLen) {
      best = volume.path;
      bestLen = path.length;
    }
  }
  return best;
}

const VOLUME_TTL_MS = 30_000;
let volumeCache: { at: number; rows: FileVolume[] } | null = null;
let volumeInflight: Promise<FileVolume[]> | null = null;

export function loadLocalFileVolumes(): Promise<FileVolume[]> {
  if (volumeCache && Date.now() - volumeCache.at < VOLUME_TTL_MS) {
    return Promise.resolve(volumeCache.rows);
  }
  if (volumeInflight) return volumeInflight;
  volumeInflight = window.ipcRenderer.invoke('fs_list_volumes', { connectionId: 'local' })
    .then((rows: unknown) => {
      const list = isFileVolumeList(rows) ? rows : [];
      volumeCache = { at: Date.now(), rows: list };
      return list;
    })
    .catch(() => [] as FileVolume[])
    .finally(() => {
      volumeInflight = null;
    });
  return volumeInflight;
}

export function isFileVolumeList(value: unknown): value is FileVolume[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => (
    item
    && typeof item === 'object'
    && typeof (item as FileVolume).path === 'string'
    && typeof (item as FileVolume).label === 'string'
  ));
}
