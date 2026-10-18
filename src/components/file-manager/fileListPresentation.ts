import type { FileSortColumn } from './fileGridLayout';

export type FileDetailColumn = 'type' | 'owner';

/** Per-pane presentation, like sorting: never migrates or rewrites saved settings. */
export const FILE_DETAIL_COLUMNS: readonly FileDetailColumn[] = ['type', 'owner'];
export const FILE_BASE_COLUMNS: readonly FileSortColumn[] = ['name', 'size', 'modified'];

export type FileListLayout = 'name' | 'size' | 'modified' | 'type' | 'all';

/** Responsive metadata budget shared by headings and rows, in listing-content pixels. */
export function fileListLayoutForWidth(width: number): FileListLayout {
  if (width <= 300) return 'name';
  if (width <= 480) return 'size';
  if (width <= 800) return 'modified';
  if (width <= 1000) return 'type';
  return 'all';
}

export function fileListColumns(details: readonly FileDetailColumn[]): FileSortColumn[] {
  return [...FILE_BASE_COLUMNS, ...FILE_DETAIL_COLUMNS.filter(column => details.includes(column))];
}

/** Shared metadata tracks; CSS supplies a fluid, bounded name limit for each pane. */
export function fileListTracks(columns: readonly FileSortColumn[]): string {
  const tracks: Record<FileSortColumn, string> = {
    name: '', size: '5rem', modified: '9rem', type: '6.5rem', owner: '8rem',
  };
  const metadataWidth = columns.filter(column => column !== 'name').reduce((width, column) => width + Number.parseFloat(tracks[column]), 0);
  tracks.name = `minmax(0, min(var(--files-name-limit, 25rem), calc(100% - ${metadataWidth}rem)))`;
  return columns.map(column => tracks[column]).join(' ');
}

/** DOM identity is instance-scoped and independent of arbitrary filesystem names. */
export function fileOptionId(scope: string, index: number): string {
  return `file-item-${scope}-${index}`;
}

/** Retain a useful final extension while the base name ellipsizes; dotfiles stay literal. */
export function fileNameParts(name: string): { base: string; extension: string } {
  const compound = name.match(/\.(?:tar\.(?:gz|bz2|xz)|d\.ts)$/i)?.[0];
  if (compound && name.length > compound.length) return { base: name.slice(0, -compound.length), extension: compound };
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 && name.length - dot <= 10
    ? { base: name.slice(0, dot), extension: name.slice(dot) }
    : { base: name, extension: '' };
}
