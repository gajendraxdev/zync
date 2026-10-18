import { filePathSeparator, normalizeFilePath, type FilePathSeparator } from './filePathNav';
import type { FileFolderOption } from './fileFolderOptions';

export interface FilePathCompletionQuery {
  parent: string;
  prefix: string;
  separator: FilePathSeparator;
}

export const FILE_PATH_SUGGESTION_LIMIT = 40;
export const FILE_PATH_SUGGESTION_DELAY_MS = 150;

/** Resolve only the listing parent; preserve spaces and let the filesystem interpret dot segments. */
export function filePathCompletionQuery(value: string, currentPath: string, homePath = ''): FilePathCompletionQuery | null {
  if (!value || !currentPath || currentPath === '~') return null;
  const separator = filePathSeparator(currentPath);
  const base = separator === '\\' ? currentPath.replace(/\//g, '\\') : currentPath;
  let path = value;
  if (value === '~' || value.startsWith('~/') || separator === '\\' && value.startsWith('~\\')) {
    if (!homePath || homePath === '~') return null;
    path = value === '~' ? `${homePath}${separator}` : `${homePath}${separator}${value.slice(2)}`;
  }
  if (separator === '\\') {
    path = path.replace(/\//g, '\\');
    // Do not guess drive-relative locations or enumerate servers/shares from a partial UNC root.
    if (/^[a-z]:/i.test(path) && !/^[a-z]:\\/i.test(path)) return null;
    if (path.startsWith('\\\\') && !/^\\\\[^\\]+\\[^\\]+\\/.test(path)) return null;
    if (!/^[a-z]:\\/i.test(path) && !path.startsWith('\\\\')) {
      if (path.startsWith('\\')) return null;
      path = `${base.endsWith(separator) ? base : `${base}${separator}`}${path}`;
    }
  } else {
    if (/^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\')) return null;
    if (!path.startsWith('/')) path = `${currentPath.endsWith('/') ? currentPath : `${currentPath}/`}${path}`;
  }
  const lastSeparator = path.lastIndexOf(separator);
  if (lastSeparator < 0) return null;
  return { parent: normalizeFilePath(path.slice(0, lastSeparator + 1)), prefix: path.slice(lastSeparator + 1), separator };
}

/** Bounded DOM results, but an accurate match count; Windows matching alone ignores case. */
export function filePathSuggestionMatches(folders: readonly FileFolderOption[], query: FilePathCompletionQuery): {
  options: FileFolderOption[];
  total: number;
} {
  const options: FileFolderOption[] = [];
  const insensitive = query.separator === '\\';
  const prefix = insensitive ? query.prefix.toLowerCase() : query.prefix;
  let total = 0;
  for (const folder of folders) {
    const name = insensitive ? folder.name.toLowerCase() : folder.name;
    if (!name.startsWith(prefix)) continue;
    total += 1;
    if (options.length < FILE_PATH_SUGGESTION_LIMIT) options.push(folder);
  }
  return { options, total };
}

/** A completed folder ends in its native separator so the next level can be suggested immediately. */
export function completeFileFolderPath(path: string, separator: FilePathSeparator): string {
  return path.endsWith(separator) ? path : `${path}${separator}`;
}
