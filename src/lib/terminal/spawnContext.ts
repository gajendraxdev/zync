export interface TerminalSpawnTabState {
  id: string;
  lastKnownCwd?: string;
  initialPath?: string;
  shellOverride?: string;
}

/** Resolves CWD and shell for a PTY spawn from tab + settings state. */
export function resolveTerminalSpawnParams(
  terminalKey: string,
  termId: string,
  terminals: Record<string, TerminalSpawnTabState[] | undefined>,
  windowsShell?: string,
): { cwd?: string; shell?: string } {
  const terminalTab = terminals[terminalKey]?.find((t) => t.id === termId);
  return {
    cwd: terminalTab?.lastKnownCwd ?? terminalTab?.initialPath,
    shell: terminalTab?.shellOverride ?? (terminalKey === 'local' ? windowsShell : undefined),
  };
}