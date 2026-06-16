import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { SearchAddon } from '@xterm/addon-search';
import type { UnlistenFn } from '@tauri-apps/api/event';
import type { InputTracker } from '../ghostSuggestions/inputTracker.js';

/** Module-level xterm instances preserved across component remounts. */
export interface TerminalCache {
  term: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  generation: number;
  spawned: boolean;
  starting: boolean;
  listenerAttached: boolean;
  pendingInput: string;
  inputFlushTimer: ReturnType<typeof window.setTimeout> | null;
  lastResize: { rows: number; cols: number } | null;
  unlisten?: UnlistenFn[];
  ghostTracker?: InputTracker;
  onDataDisposable?: { dispose: () => void };
  ligaturesAddon?: { dispose: () => void };
  ligaturesEnabled: boolean;
  ligaturesDesiredEnabled?: boolean;
  ligaturesLoadPromise?: Promise<void> | null;
}

export const terminalCache = new Map<string, TerminalCache>();

export function clearTerminalPendingInput(termId: string | null | undefined): void {
  if (!termId) return;

  const cached = terminalCache.get(termId);
  if (!cached) return;

  if (cached.inputFlushTimer !== null) {
    window.clearTimeout(cached.inputFlushTimer);
    cached.inputFlushTimer = null;
  }

  cached.pendingInput = '';
}