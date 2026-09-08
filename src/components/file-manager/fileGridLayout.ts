import type { FileEntry } from './types';

export type FileSortColumn = 'name' | 'size' | 'type' | 'modified';
export type FileSortDirection = 'asc' | 'desc';

/** List-row height from FileListItem (`py-2` + 20px icon + border). Compact does not change list rows. */
export const FILE_LIST_ROW_HEIGHT = 40;

/** Shared header/row tracks: Name | Size (w-24) | Type (w-32) | Modified (w-40). */
export const FILE_LIST_COLUMNS = 'minmax(0, 1fr) 6rem 8rem 10rem';

export interface FileGridMetrics {
  columnCount: number;
  columnWidth: number;
  rowHeight: number;
  gap: number;
}

function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function sortFileEntries(
  files: FileEntry[],
  column: FileSortColumn,
  direction: FileSortDirection,
): FileEntry[] {
  return [...files].sort((a, b) => {
    if (a.type === 'd' && b.type !== 'd') return -1;
    if (a.type !== 'd' && b.type === 'd') return 1;

    let comparison = 0;
    switch (column) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'size':
        comparison = a.size - b.size;
        break;
      case 'type':
        comparison = fileExtension(a.name).localeCompare(fileExtension(b.name));
        break;
      case 'modified':
        comparison = a.lastModified - b.lastModified;
        break;
    }
    return direction === 'asc' ? comparison : -comparison;
  });
}

export function computeFileGridMetrics(containerWidth: number, compactMode: boolean): FileGridMetrics {
  const minTrack = compactMode ? 100 : 120;
  const gap = compactMode ? 8 : 16;
  const rowHeight = compactMode ? 120 : 140;
  const width = Math.max(0, containerWidth);
  const columnCount = Math.max(1, Math.floor((width + gap) / (minTrack + gap)));
  const columnWidth = width / columnCount;
  return { columnCount, columnWidth, rowHeight, gap };
}

/** react-window slot size: track plus inter-item gap, except the last row/column. */
export function fileGridSlotSize(index: number, count: number, track: number, gap: number): number {
  if (count <= 1 || index >= count - 1) return track;
  return track + gap;
}

export function fileGridContentHeight(fileCount: number, metrics: FileGridMetrics): number {
  if (fileCount <= 0) return 0;
  const rowCount = Math.max(1, Math.ceil(fileCount / metrics.columnCount));
  return rowCount * metrics.rowHeight + Math.max(0, rowCount - 1) * metrics.gap;
}

/** Shrink the layout width when a classic vertical scrollbar will appear. */
export function computeFileGridMetricsForViewport(
  width: number,
  height: number,
  fileCount: number,
  compactMode: boolean,
  scrollbarSize: number,
): FileGridMetrics {
  const full = computeFileGridMetrics(width, compactMode);
  if (fileCount <= 0 || scrollbarSize <= 0 || fileGridContentHeight(fileCount, full) <= height) {
    return full;
  }
  return computeFileGridMetrics(Math.max(0, width - scrollbarSize), compactMode);
}

export function fileGridKeyboardIndex(row: number, col: number, columnCount: number): number {
  return row * Math.max(1, columnCount) + col;
}
