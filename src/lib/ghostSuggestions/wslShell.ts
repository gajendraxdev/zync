/** Helpers for Windows-local terminals backed by WSL. */

/** WSL spawns are slow — shared by path listing and cwd probes. */
export const WSL_FS_LIST_TIMEOUT_MS = 1200;

export function shellIdIndicatesWsl(shellId: string): boolean {
  return shellId === 'wsl' || shellId.startsWith('wsl:');
}

/** True when a cwd value looks like a Linux/WSL path (not a Windows drive path). */
export function linuxPathLooksLikeWsl(path: string): boolean {
  const trimmed = path.trim();
  return trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('/');
}

/**
 * Resolve the WSL shell id used for path listing on local Windows-backed tabs.
 * Falls back to sniffed Linux cwd when settings/tab shell id is stale (e.g. `default`).
 * Callers on SSH/remote tabs must not invoke this — keep wslShellId undefined there.
 */
export function resolveWslShellIdForPathCompletion(
  shellId?: string,
  cwd?: string,
): string | undefined {
  if (shellId && shellIdIndicatesWsl(shellId)) return shellId;
  const wslCwd = cwdForWslPathCompletion(cwd);
  if (wslCwd && linuxPathLooksLikeWsl(wslCwd)) {
    return 'wsl';
  }
  return undefined;
}

export function parseWslDistro(shellId: string): string | undefined {
  if (!shellId.startsWith('wsl:')) return undefined;
  const distro = shellId.slice(4).trim();
  return distro || undefined;
}

/** Drop Windows drive paths when the active PTY session is WSL. */
export function cwdForWslPathCompletion(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  if (/^[A-Za-z]:[/\\]/.test(cwd)) return undefined;
  return cwd;
}

export async function fetchWslCwd(
  shellId: string,
  timeoutMs = WSL_FS_LIST_TIMEOUT_MS,
): Promise<string | null> {
  if (!shellIdIndicatesWsl(shellId)) return null;
  const request = window.ipcRenderer.invoke('wsl_get_cwd', {
    wslDistro: parseWslDistro(shellId),
  }) as Promise<string>;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error('wsl_get_cwd timeout'));
    }, Math.max(50, timeoutMs));
  });
  try {
    const cwd = await Promise.race([request, timeout]);
    if (typeof cwd !== 'string') return null;
    const trimmed = cwd.trim();
    return trimmed.startsWith('/') ? trimmed : null;
  } catch {
    return null;
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  }
}