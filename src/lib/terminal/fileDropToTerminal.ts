export type FileDropShellKind = 'posix' | 'powershell' | 'cmd';

/** POSIX: quote only when the path is not a plain token. */
export function quotePosixShellArg(value: string): string {
  if (value === '') return "''";
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** PowerShell: single-quoted so `$()`, `$env:`, and backticks do not expand. */
export function quotePowerShellArg(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * cmd.exe: double-quoted, with `%` / `!` broken so `%VAR%` and `!VAR!` cannot expand,
 * and `"` doubled so the string cannot close early.
 */
export function quoteCmdExeArg(value: string): string {
  if (value === '') return '""';
  const escaped = value.replace(/%/g, '%^').replace(/!/g, '!^').replace(/"/g, '""');
  return `"${escaped}"`;
}

export function fileDropShellKind(options: {
  localWindows: boolean;
  shellId?: string | null;
}): FileDropShellKind {
  if (!options.localWindows) return 'posix';
  const id = (options.shellId ?? '').trim().toLowerCase();
  const base = id.replace(/^.*[/\\]/, '').replace(/\.exe$/, '');
  if (base === 'cmd' || base === 'command') return 'cmd';
  if (!base || base === 'default' || base === 'powershell' || base === 'pwsh' || base.startsWith('powershell')) {
    return 'powershell';
  }
  return 'posix';
}

export function formatFilePathsForTerminal(paths: string[], shell: FileDropShellKind): string {
  const quote = shell === 'cmd'
    ? quoteCmdExeArg
    : shell === 'powershell'
      ? quotePowerShellArg
      : quotePosixShellArg;
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
  const text = dataTransfer.getData('text/plain') || dataTransfer.getData('Text');
  if (text) {
    return text.split(/\r?\n/).filter((line) => line.length > 0);
  }
  return fallbackPaths.filter((path) => path.length > 0);
}
