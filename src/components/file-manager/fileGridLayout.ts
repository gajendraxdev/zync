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

export function computeFileGridMetrics(containerWidth: number, compactMode: boolean): FileGridMetrics {
  const minTrack = compactMode ? 100 : 120;
  const gap = compactMode ? 8 : 16;
  const rowHeight = compactMode ? 120 : 140;
  const width = Math.max(0, containerWidth);
  const columnCount = Math.max(1, Math.floor((width + gap) / (minTrack + gap)));
  const columnWidth = width / columnCount;
  return { columnCount, columnWidth, rowHeight, gap };
}
