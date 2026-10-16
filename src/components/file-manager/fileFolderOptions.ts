import { filePathSeparator } from './filePathNav';
import type { FileEntry } from './types';

export interface FileFolderOption { name: string; path: string }
export type FileFolderLoader = (path: string) => Promise<FileFolderOption[]>;

/** One parent listing only, with the pane's hidden-file policy and literal native path separators. */
export function fileFolderOptions(entries: readonly FileEntry[], parent: string, showHidden: boolean): FileFolderOption[] {
  const separator = filePathSeparator(parent);
  const prefix = parent.endsWith(separator) ? parent : `${parent}${separator}`;
  return entries.filter(entry => entry.type === 'd' && entry.name !== '.' && entry.name !== '..' && (showHidden || !entry.name.startsWith('.')))
    .map(entry => ({ name: entry.name, path: `${prefix}${entry.name}` }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}
