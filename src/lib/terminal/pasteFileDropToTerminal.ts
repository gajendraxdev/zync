import { getCurrentDragPaths } from '../dragDrop.js';
import { useAppStore } from '../../store/useAppStore';
import { LOCAL_TERMINAL_CONNECTION_ID } from './connectionIds.js';
import { extractFileManagerDropPaths, fileDropShellKind, formatFilePathsForTerminal, type FileDropShellKind } from './fileDropToTerminal.js';
import { queueTerminalInput } from './inputPipeline.js';
import { isWin32Platform, resolveTerminalSpawnParams } from './spawnContext.js';
import { terminalCache } from './terminalCache.js';

export function resolveFileDropShellKind(connectionId: string, termId: string): FileDropShellKind {
  const localWindows = connectionId === LOCAL_TERMINAL_CONNECTION_ID && isWin32Platform();
  if (!localWindows) return 'posix';
  const state = useAppStore.getState();
  const { shell } = resolveTerminalSpawnParams(
    connectionId,
    termId,
    state.terminals,
    state.settings.localTerm?.windowsShell,
  );
  return fileDropShellKind({ localWindows: true, shellId: shell });
}

function sendPaths(termId: string, text: string): boolean {
  const cached = terminalCache.get(termId);
  if (!cached) return false;
  queueTerminalInput(termId, text);
  cached.term?.focus();
  return true;
}

/** Queue quoted paths into the PTY. Does not use term.paste() (ghost/onData can drop that while Files is showing). */
export function pasteFilePathsIntoTerminal(
  termId: string,
  dataTransfer: DataTransfer,
  connectionId: string,
): boolean {
  const text = formatFilePathsForTerminal(
    extractFileManagerDropPaths(dataTransfer, getCurrentDragPaths()),
    resolveFileDropShellKind(connectionId, termId),
  );
  if (!text) return false;
  if (sendPaths(termId, text)) return true;
  window.requestAnimationFrame(() => {
    if (sendPaths(termId, text)) return;
    window.setTimeout(() => {
      sendPaths(termId, text);
    }, 120);
  });
  return true;
}
