import { Channel } from '@tauri-apps/api/core';
import type { Terminal as XTerm } from '@xterm/xterm';
import { feedPromptCwdSniffer } from '../ghostSuggestions/promptCwdSniffer.js';
import { feedSecretInputSniffer } from '../ghostSuggestions/secretInputDetect.js';
import { useAppStore } from '../../store/useAppStore.js';
import { terminalCache } from './terminalCache.js';
import { touchTerminalActivity } from './terminalActivity.js';
import { silenceTerminalOutputChannel } from './terminalReloadTeardown.js';
import { recordChannelFrame, recordTermWrite } from './terminalIoDebug.js';
import { selectSnifferBytes, SNIFF_FULL_MAX_BYTES } from './terminalSnifferBytes.js';
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

/** Cheap pre-filter before UTF-8 decode + prompt regex work on PTY output. */
function outputMayContainPrompt(data: Uint8Array): boolean {
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte === 0x0d || byte === 0x0a || byte === 0x24 || byte === 0x3a || byte === 0x3e) {
      return true;
    }
  }
  return false;
}

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
    if (entry.connectionId) {
      const connectionId = entry.connectionId;
      const large = data.length > SNIFF_FULL_MAX_BYTES;
      const sniff = selectSnifferBytes(data);
      feedSecretInputSniffer(termId, sniff, () => {
        const live = terminalCache.get(termId);
        live?.ghostTracker?.enterSecretInputMode();
      }, { resetDecoder: large, resetBuffer: large });
      if (outputMayContainPrompt(sniff)) {
        feedPromptCwdSniffer(termId, sniff, (path) => {
          entry.ghostTracker?.exitSecretInputMode();
          useAppStore.getState().setTerminalCwd(connectionId, termId, path);
        }, { resetDecoder: large, resetBuffer: large });
      }
    }
    const writeStarted = performance.now();
    term.write(data);
    recordTermWrite(termId, performance.now() - writeStarted);
  });

  cached.outputChannel = channel;
  return channel;
}