/** POSIX: quote only when the path is not a plain token. */
export function quotePosixShellArg(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** cmd / PowerShell: double-quote when the path has whitespace or shell metacharacters. */
export function quoteWindowsShellArg(value: string): string {
  if (value === '') return '""';
  if (!/[ \t&()[\]{}^=;!'+,`~$%"<>|]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function formatFilePathsForTerminal(paths: string[], windows: boolean): string {
  const quote = windows ? quoteWindowsShellArg : quotePosixShellArg;
  const body = paths.filter((path) => path.length > 0).map(quote).join(' ');
  return body ? `${body} ` : '';
}

export function isFileManagerPathDrag(types: readonly string[]): boolean {
  return types.includes('application/json') || types.includes('text/plain');
}

export function acceptFilePathDrag(event: {
  preventDefault: () => void;
  dataTransfer: DataTransfer;
}): boolean {
  if (!isFileManagerPathDrag(Array.from(event.dataTransfer.types || []))) return false;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  return true;
}

/** Paths from a Files-internal drag (`application/json`) or a plain-text fallback. */
export function extractFileManagerDropPaths(
  dataTransfer: DataTransfer,
  fallbackPaths: string[] = [],
): string[] {
  const json = dataTransfer.getData('application/json');
  if (json) {
    try {
      const data = JSON.parse(json) as { type?: string; path?: string; paths?: unknown };
      if (data?.type === 'server-file') {
        if (Array.isArray(data.paths)) {
          return data.paths.filter((path): path is string => typeof path === 'string' && path.length > 0);
        }
        if (typeof data.path === 'string' && data.path.length > 0) return [data.path];
      }
    } catch {
      // Fall through to text/plain.
    }
  }
  const text = (dataTransfer.getData('text/plain') || dataTransfer.getData('Text')).trim();
  if (text) {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }
  return fallbackPaths.filter((path) => path.length > 0);
}
