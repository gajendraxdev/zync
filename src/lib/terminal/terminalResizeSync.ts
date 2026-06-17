import type { Terminal as XTerm } from '@xterm/xterm';
import { terminalCache } from './terminalCache.js';

/** Sends a terminal resize only when the row or column count actually changed. */
export function syncTerminalResize(termId: string | null | undefined, term: XTerm): void {
  const nextSize = { rows: term.rows, cols: term.cols };
  if (!termId) {
    return;
  }

  const cached = terminalCache.get(termId);

  if (!cached || !cached.spawned || cached.starting) {
    return;
  }

  if (cached.lastResize?.rows === nextSize.rows && cached.lastResize?.cols === nextSize.cols) {
    return;
  }

  window.ipcRenderer.send('terminal:resize', { termId, ...nextSize });
  // Assign cache only after send (if send fails we will retry on next sync).
  cached.lastResize = nextSize;
}