import type { FileEntry } from './types';
import { FILE_GRID_ZOOM, clampFileGridZoom } from './fileChrome.js';

export type FileSortColumn = 'name' | 'size' | 'owner' | 'modified';
export type FileSortDirection = 'asc' | 'desc';

export const FILE_LIST_COLUMN_IDS: readonly FileSortColumn[] = [
  'name',
  'size',
  'owner',
  'modified',
];

export const FILE_LIST_COLUMN_LABELS: Record<FileSortColumn, string> = {
  name: 'Name',
  size: 'Size',
  owner: 'Owner:Group',
  modified: 'Modified',
};

export const FILE_LIST_COLUMN_ALIGN: Record<FileSortColumn, 'left' | 'right'> = {
  name: 'left',
  size: 'right',
  owner: 'left',
  modified: 'right',
};

/** First click on a column uses this direction (size/date: newest/largest first). */
export const FILE_LIST_SORT_INITIAL: Record<FileSortColumn, FileSortDirection> = {
  name: 'asc',
  owner: 'asc',
  size: 'desc',
  modified: 'desc',
};

export function fileListSortSense(column: FileSortColumn, direction: FileSortDirection): string {
  switch (column) {
    case 'name':
    case 'owner':
      return direction === 'asc' ? 'A to Z' : 'Z to A';
    case 'size':
      return direction === 'asc' ? 'smallest first' : 'largest first';
    case 'modified':
      return direction === 'asc' ? 'oldest first' : 'newest first';
  }
}

export function fileListSortTooltip(
  column: FileSortColumn,
  activeColumn: FileSortColumn,
  direction: FileSortDirection,
): string {
  const label = FILE_LIST_COLUMN_LABELS[column];
  if (column === activeColumn) {
    const next = direction === 'asc' ? 'desc' : 'asc';
    return `${label} · ${fileListSortSense(column, direction)}. Click for ${fileListSortSense(column, next)}.`;
  }
  const initial = FILE_LIST_SORT_INITIAL[column];
  return `Sort by ${label}, ${fileListSortSense(column, initial)}`;
}

/** List-row height from FileListItem (`py-2` + 20px icon + border). Compact does not change list rows. */
export const FILE_LIST_ROW_HEIGHT = 40;

/** Name flexes. Size / owner:group / modified stay capped and can shrink. */
export const FILE_LIST_COLUMNS = 'minmax(0, 1fr) minmax(0, 5.25rem) minmax(0, 9.5rem) minmax(0, 7.5rem)';

/** Grid hover card: name, Folder/size, owner:group, date. */
export function fileHoverHint(file: FileEntry, dateTimeFormat: 'simple' | 'detailed' = 'simple'): string {
  const identity = formatFileIdentity(file.owner || '', file.group || '');
  const modified = formatFileListDate(file.lastModified, Date.now(), dateTimeFormat);
  const kind = file.type === 'd' ? 'Folder' : formatBytesForHint(file.size);
  return [file.name, kind, identity, modified].filter(Boolean).join('\n');
}

function formatBytesForHint(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '';
  if (size < 1024) return `${size} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 10 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** `admin:staff`, or empty when both are missing. */
export function formatFileIdentity(owner: string, group: string): string {
  const user = (owner || '').trim();
  const grp = (group || '').trim();
  if (!user && !grp) return '';
  if (user && grp) return `${user}:${grp}`;
  return user || grp;
}

/** Compact list/grid dates: time today, `Sep 2` this year, else `Nov 20, 2025`. */
export function formatFileListDate(
  timestamp: number,
  nowMs: number = Date.now(),
  format: 'simple' | 'detailed' = 'simple',
): string {
  const ms = timestamp > 0 && timestamp < 1e10 ? timestamp * 1000 : timestamp;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime()) || timestamp === 0) return '';
  if (format === 'detailed') {
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
  const now = new Date(nowMs);
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export interface FileGridMetrics {
  columnCount: number;
  columnWidth: number;
  rowHeight: number;
  gap: number;
}

export function sortFileEntries(
  files: FileEntry[],
  column: FileSortColumn,
  direction: FileSortDirection,
  foldersFirst = true,
): FileEntry[] {
  return [...files].sort((a, b) => {
    if (foldersFirst) {
      if (a.type === 'd' && b.type !== 'd') return -1;
      if (a.type !== 'd' && b.type === 'd') return 1;
    }

    let comparison = 0;
    switch (column) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'size':
        comparison = a.size - b.size;
        break;
      case 'owner': {
        const left = formatFileIdentity(a.owner || '', a.group || '');
        const right = formatFileIdentity(b.owner || '', b.group || '');
        comparison = left.localeCompare(right);
        break;
      }
      case 'modified':
        comparison = a.lastModified - b.lastModified;
        break;
    }
    return direction === 'asc' ? comparison : -comparison;
  });
}

/** Cell coordinates for a file index, or null if they would miss the current grid. */
export function fileGridScrollTarget(
  fileIndex: number,
  columnCount: number,
  rowCount: number,
): { rowIndex: number; columnIndex: number } | null {
  if (rowCount <= 0) return null;
  const cols = Math.max(1, columnCount);
  const rows = rowCount;
  if (fileIndex < 0) return null;
  const rowIndex = Math.floor(fileIndex / cols);
  const columnIndex = fileIndex % cols;
  if (rowIndex >= rows || columnIndex >= cols) return null;
  return { rowIndex, columnIndex };
}

export function computeFileGridMetrics(
  containerWidth: number,
  compactMode: boolean,
  zoomLevel?: number,
): FileGridMetrics {
  if (zoomLevel === undefined) {
    const minTrack = compactMode ? 90 : 104;
    const gap = compactMode ? 6 : 8;
    const rowHeight = compactMode ? 100 : 120;
    const width = Math.max(0, containerWidth);
    const columnCount = Math.max(1, Math.floor((width + gap) / (minTrack + gap)));
    const columnWidth = width / columnCount;
    return { columnCount, columnWidth, rowHeight, gap };
  }
  const zoom = FILE_GRID_ZOOM[clampFileGridZoom(zoomLevel)];
  const minTrack = zoom.minTrack;
  const gap = zoom.gap;
  const rowHeight = zoom.rowHeight;
  const width = Math.max(0, containerWidth);
  const columnCount = Math.max(1, Math.floor((width + gap) / (minTrack + gap)));
  const columnWidth = width / columnCount;
  return { columnCount, columnWidth, rowHeight, gap };
}
