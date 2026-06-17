import type { Terminal as XTerm } from '@xterm/xterm';
import { listen } from '@tauri-apps/api/event';
import { clearTerminalInputQueue } from './inputQueue.js';
import { handleTerminalReady } from './inputPipeline.js';
import { clearTerminalPendingInput, terminalCache } from './terminalCache.js';

export interface TerminalLifecycleEvent {
  generation: number;
  exit_code?: number;
}

export interface TerminalOutputEvent extends TerminalLifecycleEvent {
  data: number[];
}

/** Attaches generation-gated output, ready, and exit listeners once per cached terminal. */
export function attachTerminalLifecycleListeners(sessionId: string, term: XTerm): void {
  const cached = terminalCache.get(sessionId);
  if (!cached || cached.listenerAttached) {
    return;
  }

  if (!cached.unlisten) {
    cached.unlisten = [];
  }

  listen<TerminalOutputEvent>(`terminal-output-${sessionId}`, (event) => {
    const entry = terminalCache.get(sessionId);
    if (!entry || event.payload.generation !== entry.generation) {
      return;
    }
    term.write(new Uint8Array(event.payload.data));
  }).then((unlistenFn) => {
    if (terminalCache.has(sessionId)) {
      terminalCache.get(sessionId)?.unlisten?.push(unlistenFn);
    }
  });

  listen<TerminalLifecycleEvent>(`terminal-ready-${sessionId}`, (event) => {
    handleTerminalReady(sessionId, event.payload.generation);
  }).then((unlistenFn) => {
    if (terminalCache.has(sessionId)) {
      terminalCache.get(sessionId)?.unlisten?.push(unlistenFn);
    }
  });

  listen<TerminalLifecycleEvent>(`terminal-exit-${sessionId}`, (event) => {
    const entry = terminalCache.get(sessionId);
    if (!entry) {
      return;
    }

    if (event.payload.generation !== entry.generation) {
      return;
    }

    const suspendedForPanel = entry.suspendedByPanel;
    entry.suspendedByPanel = false;
    entry.starting = false;
    entry.spawned = false;
    clearTerminalPendingInput(sessionId);
    clearTerminalInputQueue(sessionId);
    entry.lastResize = null;

    if (!suspendedForPanel) {
      term.write('\r\n\x1b[33m[Terminal session ended. Press Enter to restart.]\x1b[0m\r\n');
    }
  }).then((unlistenFn) => {
    if (terminalCache.has(sessionId)) {
      terminalCache.get(sessionId)?.unlisten?.push(unlistenFn);
    }
  });

  cached.listenerAttached = true;
}