import { getCurrentDragPaths } from '../dragDrop.js';
import { queueTerminalInput } from './inputPipeline.js';
import { terminalCache } from './terminalCache.js';
import { extractFileManagerDropPaths, formatFilePathsForTerminal } from './fileDropToTerminal.js';

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
  windows: boolean,
): boolean {
  const text = formatFilePathsForTerminal(
    extractFileManagerDropPaths(dataTransfer, getCurrentDragPaths()),
    windows,
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
