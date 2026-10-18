/** Helpers for Windows-local terminals backed by WSL. */

export function shellIdIndicatesWsl(shellId: string): boolean {
  return shellId === 'wsl' || shellId.startsWith('wsl:');
}

/**
 * Resolve WSL only from the spawned shell identity on a local Windows tab.
 * A Unix-looking CWD is also valid in PowerShell and Unix hosts; it cannot identify WSL.
 */
export function resolveWslShellIdForPathCompletion(
  shellId?: string,
  windowsLocal = false,
): string | undefined {
  return windowsLocal && shellId && shellIdIndicatesWsl(shellId) ? shellId : undefined;
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
