import { useAppStore } from '../../store/useAppStore.js';
import { scheduleZshAutosuggestProbe } from '../ghostSuggestions/zshAutosuggestDetect.js';
import { clearPromptCwdSniffer } from '../ghostSuggestions/promptCwdSniffer.js';
import { invalidateTerminalGhostCwd, terminalCache } from './terminalCache.js';
import { touchTerminalActivity } from './terminalActivity.js';
import { clearIdleHostSuspendNotice } from './terminalIdleSuspendNotice.js';
import { flushTerminalResize } from './terminalResizeSync.js';
import { isWin32Platform, resolveLocalWindowsShellId } from './spawnContext.js';

const INPUT_BATCH_MS = 4;
const INPUT_FLUSH_THRESHOLD = 64;
const inputByteEncoder = new TextEncoder();
const IMMEDIATE_INPUT_PATTERN = /[\r\n\x03\x04\x1b]/;

export function canSendTerminalInput(termId: string | null | undefined): boolean {
  if (!termId) return false;
  const cached = terminalCache.get(termId);
  return Boolean(cached && cached.spawned && !cached.starting);
}

/**
 * Sends queued terminal input to the backend as a single IPC write.
 * Held while `starting` until `handleTerminalReady` flushes the buffer.
 */
export function flushPendingInput(termId: string | null | undefined): void {
  if (!termId) return;

  const cached = terminalCache.get(termId);
  if (!cached || cached.starting || !cached.spawned) return;

  if (cached.inputFlushTimer !== null) {
    window.clearTimeout(cached.inputFlushTimer);
    cached.inputFlushTimer = null;
  }

  if (!cached.pendingInput) return;

  if (!canSendTerminalInput(termId)) {
    return;
  }

  const data = cached.pendingInput;
  // Includes snippets, pasted commands and shell-history Enter, not just tracked `cd`.
  // Invalidate at send time too: input may have waited for ready while a prompt arrived.
  if (/[\r\n]/.test(data)) {
    cached.ghostCommandEpoch = (cached.ghostCommandEpoch ?? 0) + 1;
    invalidateTerminalGhostCwd(termId);
    clearPromptCwdSniffer(termId);
  }
  window.ipcRenderer.send('terminal:write', { termId, data });
  // Clear only after send (prevents loss on sync throw; fire-and-forget IPC is best-effort).
  cached.pendingInput = '';
  cached.pendingInputBytes = 0;
}

/**
 * Queues terminal input for a short batching window while still flushing
 * immediately for control-sensitive keys and larger chunks.
 * Buffers without IPC while the PTY session is still starting.
 */
export function queueTerminalInput(termId: string | null | undefined, data: string): void {
  if (!termId) return;

  const cached = terminalCache.get(termId);
  if (!cached) {
    return;
  }

  cached.pendingInput += data;
  cached.pendingInputBytes = (cached.pendingInputBytes || 0) + inputByteEncoder.encode(data).length;
  touchTerminalActivity(termId);

  if (!cached.spawned || cached.starting) {
    return;
  }

  const bufferedBytes = cached.pendingInputBytes;
  const shouldFlushImmediately = IMMEDIATE_INPUT_PATTERN.test(data) || bufferedBytes >= INPUT_FLUSH_THRESHOLD;

  if (shouldFlushImmediately) {
    flushPendingInput(termId);
    return;
  }

  if (cached.inputFlushTimer === null) {
    cached.inputFlushTimer = window.setTimeout(() => {
      flushPendingInput(termId);
    }, INPUT_BATCH_MS);
  }
}

/** Called when `terminal-ready` arrives for the active generation. */
export function handleTerminalReady(termId: string, generation: number): boolean {
  const cached = terminalCache.get(termId);
  if (!cached || cached.generation !== generation) {
    return false;
  }

  cached.starting = false;
  cached.spawned = true;
  cached.spawnBlocked = false;
  cached.suspendedByIdle = false;
  if (cached.connectionId) {
    const store = useAppStore.getState();
    const pendingSpawnShell = cached.pendingSpawnShell;
    cached.pendingSpawnShell = undefined;
    const termTab = store.terminals[cached.connectionId]?.find((t) => t.id === termId);
    if (pendingSpawnShell && !termTab?.shellOverride) {
      // Stamp shell at spawn so tab icons stay fixed. PowerShell expand is Windows-only.
      let stamped: string | undefined = pendingSpawnShell;
      if (cached.connectionId === 'local') {
        if (isWin32Platform()) {
          stamped = resolveLocalWindowsShellId(pendingSpawnShell);
        } else {
          const trimmed = pendingSpawnShell.trim();
          stamped = !trimmed || trimmed === 'default' ? undefined : trimmed;
        }
      }
      if (stamped) {
        store.setTerminalShellOverride(cached.connectionId, termId, stamped);
      }
    }
    const shellId = termTab?.shellOverride
      ?? pendingSpawnShell
      ?? (cached.connectionId === 'local' ? store.settings.localTerm?.windowsShell : undefined);
    scheduleZshAutosuggestProbe(termId, cached.connectionId, shellId);
    // SFTP cwd and `wsl.exe pwd` describe separate processes, not this PTY.
    // Await prompt/OSC 7 evidence instead of letting delayed probes overwrite it.
  }
  clearIdleHostSuspendNotice(termId);
  flushPendingInput(termId);
  // Geometry uses the same pending→flush contract as input (#101).
  flushTerminalResize(termId);
  return true;
}
