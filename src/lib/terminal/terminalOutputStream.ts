import { Channel } from '@tauri-apps/api/core';
import type { Terminal as XTerm } from '@xterm/xterm';
import { clearSecretInputSniffer, feedTerminalPromptSniffers } from '../ghostSuggestions/secretInputDetect.js';
import { useAppStore } from '../../store/useAppStore.js';
import { confirmTerminalGhostCwd, terminalCache } from './terminalCache.js';
import { touchTerminalActivity } from './terminalActivity.js';
import { silenceTerminalOutputChannel } from './terminalReloadTeardown.js';
import { recordChannelFrame, recordTermWrite } from './terminalIoDebug.js';
import { selectSnifferBytes, SNIFF_FULL_MAX_BYTES } from './terminalSnifferBytes.js';
import { canTrackTerminalShell } from './terminalShellContext.js';
import {
  decodeTerminalOutputChannelFrame,
  GENERATION_HEADER_BYTES,
  terminalOutputMessageToArrayBuffer,
} from './terminalOutputFrame.js';

export { selectSnifferBytes, SNIFF_FULL_MAX_BYTES, SNIFF_TAIL_BYTES } from './terminalSnifferBytes.js';
export {
  decodeTerminalOutputChannelFrame,
  type TerminalOutputChannelFrame,
} from './terminalOutputFrame.js';

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined'
    && Boolean((window as Window & { __TAURI_INTERNALS__?: { transformCallback?: unknown } }).__TAURI_INTERNALS__?.transformCallback);
}

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
  const cached = terminalCache.get(termId);
  if (!cached) {
    throw new Error(`No terminal cache entry for ${termId}`);
  }

  if (cached.outputChannel) {
    silenceTerminalOutputChannel(cached.outputChannel);
  }

  if (!isTauriRuntime()) {
    const stub = createStubOutputChannel();
    cached.outputChannel = stub;
    return stub;
  }

  const channel = new Channel((message) => {
    const entry = terminalCache.get(termId);
    if (!entry) {
      return;
    }

    const payload = terminalOutputMessageToArrayBuffer(message);
    if (!payload || payload.byteLength < GENERATION_HEADER_BYTES) {
      return;
    }

    const { generation, data } = decodeTerminalOutputChannelFrame(payload);
    if (generation !== entry.generation) {
      return;
    }

    touchTerminalActivity(termId);
    recordChannelFrame(termId, data.byteLength);
    const contextEpoch = entry.ghostContextEpoch;
    const commandEpoch = entry.ghostCommandEpoch;
    const startedInNormalBuffer = canTrackTerminalShell(term);
    const startedInShell = canTrackTerminalShell(term, entry.ghostPaused);
    const writeStarted = performance.now();
    term.write(data, () => {
      recordTermWrite(termId, performance.now() - writeStarted);
      // OSC 7 runs during parsing, before this callback. Consume even rejected
      // reports so old queued output cannot acquire a later frame's provenance.
      const osc7Cwd = entry.pendingOsc7Cwd;
      entry.pendingOsc7Cwd = undefined;
      const sameSessionFrame = terminalCache.get(termId) === entry && entry.generation === generation
        && entry.ghostContextEpoch === contextEpoch;
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
    });
  });

  cached.outputChannel = channel;
  return channel;
}
