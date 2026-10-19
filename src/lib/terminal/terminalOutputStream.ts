import { Channel, invoke } from '@tauri-apps/api/core';
import type { Terminal as XTerm } from '@xterm/xterm';
import { clearSecretInputSniffer, feedTerminalPromptSniffers } from '../ghostSuggestions/secretInputDetect.js';
import { useAppStore } from '../../store/useAppStore.js';
import { confirmTerminalGhostCwd, terminalCache, type TerminalCache } from './terminalCache.js';
import { touchTerminalActivity } from './terminalActivity.js';
import { silenceTerminalOutputChannel } from './terminalReloadTeardown.js';
import { recordChannelFrame, recordTermWrite } from './terminalIoDebug.js';
import { selectSnifferBytes, SNIFF_FULL_MAX_BYTES } from './terminalSnifferBytes.js';
import { canTrackTerminalShell } from './terminalShellContext.js';
import { notify } from '../../features/notifications/notify.js';
import {
  decodeTerminalOutputChannelFrame,
  terminalOutputMessageToArrayBuffer,
} from './terminalOutputFrame.js';

export { selectSnifferBytes, SNIFF_FULL_MAX_BYTES, SNIFF_TAIL_BYTES } from './terminalSnifferBytes.js';
export {
  decodeTerminalOutputChannelFrame,
  type TerminalOutputChannelFrame,
} from './terminalOutputFrame.js';

/** Browser-only previews do not own a native channel or output-credit window. */
function isTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { __TAURI_INTERNALS__?: { transformCallback?: unknown } }).__TAURI_INTERNALS__?.transformCallback);
}

/** Preserve the create-command shape in browser fixtures without native callbacks. */
function createStubOutputChannel(): Channel {
  return {
    id: 0,
    onmessage: () => {},
    toJSON: () => '__CHANNEL__:0',
  } as unknown as Channel;
}

/**
 * Registers a Tauri output channel for the next terminal:create invoke.
 * Replaces any prior channel handler for this session.
 */
export function attachTerminalOutputChannel(termId: string, term: XTerm): Channel {
  const existing = terminalCache.get(termId);
  if (!existing) {
    throw new Error(`No terminal cache entry for ${termId}`);
  }
  const cached = existing;

  if (cached.outputChannel) {
    silenceTerminalOutputChannel(cached.outputChannel);
  }

  if (!isTauriRuntime()) {
    const stub = createStubOutputChannel();
    cached.outputChannel = stub;
    return stub;
  }

  const generation = cached.generation;
  let received = 0;
  let parsed = 0;
  let acknowledged = 0;
  let ackInFlight = false;
  let ackScheduled = false;
  let failed = false;

  /** Credits from old xterm/channel owners cannot release a replacement PTY. */
  function isCurrent(): boolean {
    return !failed && terminalCache.get(termId) === cached && cached.term === term
      && cached.generation === generation && cached.outputChannel === channel;
  }

  /** Contain transport faults; never throw through Tauri's ordered channel callback. */
  function fail(): void {
    if (!isCurrent()) return;
    failed = true;
    try {
      void invoke('terminal_output_failed', { termId, generation, channelId: channel.id }).catch(() => {});
    } catch { /* A disposed IPC bridge must not poison ordered channel delivery. */ }
    try {
      notify.error('Terminal output stopped unexpectedly. Open a new terminal to continue.', { source: 'terminal' });
    } catch { /* Notification subscribers are independent of output transport. */ }
  }

  /** Send one cumulative parsed frontier; an in-flight invoke bounds promise growth. */
  async function flushAcknowledgements(): Promise<void> {
    ackScheduled = false;
    if (!isCurrent() || ackInFlight || parsed <= acknowledged) return;
    ackInFlight = true;
    const sequence = parsed;
    try {
      await invoke('terminal_ack_output', { termId, generation, channelId: channel.id, sequence });
      acknowledged = sequence;
    } catch {
      fail();
    } finally {
      ackInFlight = false;
      if (isCurrent() && parsed > acknowledged) scheduleAcknowledgement();
    }
  }

  /** Coalesce callbacks without paint timers, which may stop for hidden windows. */
  function scheduleAcknowledgement(): void {
    if (!isCurrent() || ackScheduled || ackInFlight) return;
    ackScheduled = true;
    queueMicrotask(() => { void flushAcknowledgements(); });
  }

  /** Preserve prompt provenance after xterm parsing; ancillary failures never withhold credit. */
  function observeParsedOutput(entry: TerminalCache, data: Uint8Array,
    contextEpoch: number | undefined, commandEpoch: number | undefined,
    startedInNormalBuffer: boolean, startedInShell: boolean): void {
    // OSC 7 runs during parsing, before this callback. Consume even rejected
    // reports so old queued output cannot acquire a later frame's provenance.
    const osc7Cwd = entry.pendingOsc7Cwd;
    entry.pendingOsc7Cwd = undefined;
    const sameSessionFrame = isCurrent() && entry.ghostContextEpoch === contextEpoch;
    const currentFrame = sameSessionFrame && entry.ghostCommandEpoch === commandEpoch;
    let confirmedOsc7Cwd = false;
    if (currentFrame && osc7Cwd && entry.connectionId && startedInNormalBuffer && canTrackTerminalShell(term)
      && confirmTerminalGhostCwd(termId, osc7Cwd, generation)) {
      useAppStore.getState().setTerminalCwd(entry.connectionId, termId, osc7Cwd);
      confirmedOsc7Cwd = true;
    }
    // xterm must parse mode transitions before output can influence shell
    // history/CWD. A round trip through an alternate buffer is unsafe too.
    if (!sameSessionFrame || !entry.ghostContextActive
      || !startedInShell || !canTrackTerminalShell(term, entry.ghostPaused)
    ) return;
    if (entry.connectionId) {
      const connectionId = entry.connectionId;
      const large = data.length > SNIFF_FULL_MAX_BYTES;
      const sniff = selectSnifferBytes(data);
      // Feed every bounded fragment: a path/prompt may be split across frames
      // without punctuation in the middle fragment (and Unix prompts use #/%).
      feedTerminalPromptSniffers(termId, sniff, entry.ghostTracker, (path) => {
        confirmTerminalGhostCwd(termId, path, generation);
        useAppStore.getState().setTerminalCwd(connectionId, termId, path);
      }, { resetDecoder: large, resetBuffer: large, allowPromptRecovery: currentFrame });
    }
    // Positive password detection above wins over OSC 7 in the same frame.
    // Paused/unbound contexts return earlier: they cannot safely recover from
    // hidden input when their password detector did not inspect this frame.
    if (confirmedOsc7Cwd && entry.ghostTracker?.recoverSecretInputAfterSubmit()) {
      clearSecretInputSniffer(termId);
    }
  }

  /** Validate ordered native frames and return credit only from xterm's parse callback. */
  function receive(message: unknown): void {
    if (!isCurrent()) return;
    const payload = terminalOutputMessageToArrayBuffer(message);
    if (!payload) { fail(); return; }
    const frame = decodeTerminalOutputChannelFrame(payload);
    if (frame.generation !== generation) return;
    const { sequence, data } = frame;
    if (sequence !== received + 1 || data.byteLength === 0) { fail(); return; }
    received = sequence;
    try {
      touchTerminalActivity(termId);
      recordChannelFrame(termId, data.byteLength);
    } catch { /* Optional diagnostics cannot drop terminal bytes. */ }
    const contextEpoch = cached.ghostContextEpoch;
    const commandEpoch = cached.ghostCommandEpoch;
    const startedInNormalBuffer = canTrackTerminalShell(term);
    const startedInShell = canTrackTerminalShell(term, cached.ghostPaused);
    const writeStarted = performance.now();
    term.write(data, () => {
      try { recordTermWrite(termId, performance.now() - writeStarted); } catch { /* Diagnostics only. */ }
      try {
        observeParsedOutput(cached, data, contextEpoch, commandEpoch, startedInNormalBuffer, startedInShell);
      } catch {
        // If a suggestion/store subscriber fails, keep shell input fail-closed
        // without treating already parsed terminal bytes as a transport fault.
        try { if (isCurrent()) cached.ghostTracker?.enterSecretInputMode(); } catch { /* Detached tracker. */ }
      }
      try {
        if (!isCurrent()) return;
        if (sequence !== parsed + 1) { fail(); return; }
        parsed = sequence;
        scheduleAcknowledgement();
      } catch { fail(); }
    });
  }

  const channel = new Channel((message) => {
    try { receive(message); } catch { fail(); }
  });

  cached.outputChannel = channel;
  return channel;
}
