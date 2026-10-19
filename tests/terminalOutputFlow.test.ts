import { Channel } from '@tauri-apps/api/core';
import type { attachTerminalOutputChannel } from '../src/lib/terminal/terminalOutputStream';
import type { TerminalCache } from '../src/lib/terminal/terminalCache';
import * as frames from '../src/lib/terminal/terminalOutputFrame';

type StreamModule = { attachTerminalOutputChannel: typeof attachTerminalOutputChannel };
type Invocation = { command: string; args: Record<string, unknown> };
type Write = { data: Uint8Array; done: () => void };

function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
  }
}

/** Run against the production stream and the installed Tauri Channel ordering implementation. */
export async function runOutputFlowChecks(
  loadStream: (dependencies: Record<string, unknown>, globals: Record<string, unknown>) => StreamModule,
): Promise<void> {
  let checks = 0;
  const previousWindow = globalThis.window;

  /** Give promises and the non-paint ACK microtask their deterministic turn. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  }

  /** Keep transport/parser boundaries controllable without copying flow-control logic. */
  function fixture() {
    const callbacks = new Map<number, (message: unknown) => void>();
    const unregistered: number[] = [];
    let nextCallback = 0;
    globalThis.window = {
      __TAURI_INTERNALS__: {
        transformCallback: (fn: (message: unknown) => void) => { callbacks.set(++nextCallback, fn); return nextCallback; },
        unregisterCallback: (id: number) => { unregistered.push(id); callbacks.delete(id); },
      },
    } as unknown as Window & typeof globalThis;
    const calls: Invocation[] = [];
    const notifications: string[] = [];
    const writes: Write[] = [];
    const pendingAcks: { resolve: () => void; reject: () => void }[] = [];
    const options = { holdAcks: false, writeThrows: false, diagnosticsThrow: false,
      observerThrows: false, notificationThrows: false, faultInvokeThrows: false };
    let guards = 0;
    const term = {
      buffer: { active: { type: 'normal' } }, modes: { mouseTrackingMode: 'none' },
      write(data: Uint8Array, done: () => void) {
        if (options.writeThrows) throw new Error('synthetic parser enqueue failure');
        writes.push({ data, done });
      },
    } as unknown as TerminalCache['term'];
    const entry = {
      term, generation: 7, spawned: true, connectionId: 'local', ghostContextActive: false,
      ghostTracker: { enterSecretInputMode: () => { guards++; } },
    } as TerminalCache;
    const cache = new Map([['session', entry]]);
    const stream = loadStream({
      '@tauri-apps/api/core': {
        Channel,
        invoke: (command: string, args: Record<string, unknown>) => {
          calls.push({ command, args });
          if (command === 'terminal_output_failed' && options.faultInvokeThrows) throw new Error('disposed bridge');
          return command === 'terminal_ack_output' && options.holdAcks
            ? new Promise<void>((resolve, reject) => pendingAcks.push({ resolve, reject: () => reject(new Error('synthetic ACK failure')) }))
            : Promise.resolve();
        },
      },
      '../ghostSuggestions/secretInputDetect.js': {
        clearSecretInputSniffer() {}, feedTerminalPromptSniffers() { if (options.observerThrows) throw new Error('subscriber failed'); },
      },
      '../../store/useAppStore.js': { useAppStore: { getState: () => ({ setTerminalCwd() {} }) } },
      './terminalCache.js': { terminalCache: cache, confirmTerminalGhostCwd: () => true },
      './terminalActivity.js': { touchTerminalActivity() {} },
      './terminalReloadTeardown.js': { silenceTerminalOutputChannel: (channel: Channel) => { channel.onmessage = () => {}; } },
      './terminalIoDebug.js': {
        recordChannelFrame() { if (options.diagnosticsThrow) throw new Error('diagnostic subscriber'); },
        recordTermWrite() { if (options.diagnosticsThrow) throw new Error('diagnostic subscriber'); },
      },
      './terminalSnifferBytes.js': { selectSnifferBytes: (bytes: Uint8Array) => bytes, SNIFF_FULL_MAX_BYTES: 8192 },
      './terminalShellContext.js': { canTrackTerminalShell: (_term: unknown, paused: boolean) => term.buffer.active.type === 'normal' && !paused },
      '../../features/notifications/notify.js': { notify: { error: (message: string) => {
        notifications.push(message); if (options.notificationThrows) throw new Error('notification subscriber');
      } } },
      './terminalOutputFrame.js': frames,
    }, { window: globalThis.window, performance, queueMicrotask });
    let channel = stream.attachTerminalOutputChannel('session', term);
    let nextIndex = 0;

    /** Native binary layout is generation + sequence + bytes, all header fields LE. */
    function frame(sequence: number, text = `frame-${sequence}`, generation = 7): ArrayBuffer {
      const bytes = new TextEncoder().encode(text);
      const result = new Uint8Array(8 + bytes.length);
      const header = new DataView(result.buffer);
      header.setUint32(0, generation, true); header.setUint32(4, sequence, true);
      result.set(bytes, 8);
      return result.buffer;
    }

    /** Deliver raw ordered-envelope messages through the installed Tauri callback. */
    function deliver(payload: unknown, index = nextIndex++): void {
      const callback = callbacks.get(channel.id);
      if (!callback) throw new Error('missing installed Tauri callback');
      callback({ index, message: payload });
    }

    return { entry, cache, options, writes, calls, pendingAcks, notifications, unregistered, frame, deliver,
      guards: () => guards,
      ackSequences: () => calls.filter(call => call.command === 'terminal_ack_output').map(call => call.args.sequence),
      faults: () => calls.filter(call => call.command === 'terminal_output_failed'),
      channel: () => channel,
      parse: () => { const write = writes.shift(); if (!write) throw new Error('no queued xterm parse'); write.done(); },
      end: (index = nextIndex) => callbacks.get(channel.id)?.({ index, end: true }),
      reattach: () => { channel = stream.attachTerminalOutputChannel('session', term); nextIndex = 0; },
    };
  }

  try {
    {
      const f = fixture();
      for (let sequence = 1; sequence <= 3; sequence++) f.deliver(f.frame(sequence));
      await settle(); equal(f.ackSequences(), [], 'delivery never returns unparsed credit');
      f.parse(); f.parse(); f.parse(); await settle();
      equal(f.ackSequences(), [3], 'same-turn parse completions coalesce cumulatively without paint');
      equal(f.calls[0].args, { termId: 'session', generation: 7, channelId: f.channel().id, sequence: 3 }, 'ACK identity is explicit');
      checks++;
    }
    {
      const f = fixture(); f.options.holdAcks = true;
      f.deliver(f.frame(1)); f.parse(); await settle();
      for (let sequence = 2; sequence <= 64; sequence++) { f.deliver(f.frame(sequence)); f.parse(); }
      await settle(); equal(f.ackSequences(), [1], 'at most one invoke is outstanding for a slow bridge');
      equal(f.pendingAcks.length, 1, 'no per-frame promise chain accumulates');
      f.pendingAcks.shift()!.resolve(); await settle();
      equal(f.ackSequences(), [1, 64], 'next ACK covers the newest parsed frontier');
      f.pendingAcks.shift()!.resolve(); await settle(); checks++;
    }
    {
      const f = fixture(); f.options.diagnosticsThrow = true;
      // Tauri receives envelope 1 first and must drain it after envelope 0,
      // even when our optional instrumentation throws during each delivery.
      f.deliver(f.frame(2), 1); f.deliver(f.frame(1), 0);
      equal(f.writes.map(write => new TextDecoder().decode(write.data)), ['frame-1', 'frame-2'], 'ordered Tauri drain remains alive');
      f.parse(); f.parse(); await settle(); f.end(2);
      equal(f.ackSequences(), [2], 'diagnostic failures cannot withhold parser credit');
      equal(f.unregistered.length, 1, 'Tauri channel end is still reached');
      equal(f.faults(), [], 'ancillary failures do not kill the PTY'); checks++;
    }
    for (const context of ['paused', 'unbound', 'alternate']) {
      const f = fixture(); f.entry.ghostContextActive = true;
      if (context === 'paused') f.entry.ghostPaused = true;
      if (context === 'unbound') f.entry.ghostContextActive = false;
      if (context === 'alternate') (f.entry.term.buffer.active as { type: string }).type = 'alternate';
      f.deliver(f.frame(1)); f.parse(); await settle();
      equal(f.ackSequences(), [1], `${context} shell observers cannot gate parser ACKs`); checks++;
    }
    {
      const f = fixture(); f.entry.ghostContextActive = true; f.options.observerThrows = true;
      f.deliver(f.frame(1)); f.parse(); f.deliver(f.frame(2)); f.parse(); await settle();
      equal(f.ackSequences(), [2], 'throwing ghost callback does not poison xterm write callbacks');
      equal(f.faults(), [], 'parsed data is not reported as transport failure');
      equal(f.guards(), 2, 'suggestion observers fail closed'); checks++;
    }
    for (const replacement of ['generation', 'channel', 'cache']) {
      const f = fixture(); f.deliver(f.frame(1));
      if (replacement === 'generation') f.entry.generation++;
      if (replacement === 'channel') f.reattach();
      if (replacement === 'cache') f.cache.set('session', { ...f.entry });
      f.parse(); await settle();
      equal(f.ackSequences(), [], `${replacement} replacement rejects stale parsed credit`);
      equal(f.faults(), [], 'stale callbacks do not terminate the replacement'); checks++;
    }
    {
      const f = fixture(); f.options.holdAcks = true; f.deliver(f.frame(1)); f.parse(); await settle();
      f.entry.generation++; f.reattach(); f.pendingAcks.shift()!.reject(); await settle();
      equal(f.faults(), [], 'late rejected ACK cannot fail its replacement'); checks++;
    }
    {
      const f = fixture(); f.options.holdAcks = true; f.deliver(f.frame(1)); f.parse(); await settle();
      f.pendingAcks.shift()!.reject(); await settle();
      equal(f.faults().length, 1, 'current ACK failure stops a silently stalled transport');
      equal(f.notifications.length, 1, 'current fault uses one existing notification'); checks++;
    }
    for (const malformed of ['short', 'oversized', 'type', 'gap', 'empty']) {
      const f = fixture();
      const payload = malformed === 'short' ? new ArrayBuffer(7)
        : malformed === 'oversized' ? new ArrayBuffer(8 + 16 * 1024 + 1)
        : malformed === 'type' ? 'not binary'
        : malformed === 'gap' ? f.frame(2) : f.frame(1, '');
      f.deliver(payload); f.deliver(f.frame(3)); await settle(); f.end();
      equal(f.faults().length, 1, `${malformed} faults once without escaping ordered callback`);
      equal(f.writes.length, 0, 'invalid or post-failure frames never reach xterm');
      equal(f.unregistered.length, 1, 'channel end remains reachable after fault'); checks++;
    }
    {
      const f = fixture(); f.options.writeThrows = true; f.options.notificationThrows = true; f.options.faultInvokeThrows = true;
      f.deliver(f.frame(1)); f.deliver(f.frame(2)); f.end(); await settle();
      equal(f.faults().length, 1, 'enqueue failure is contained even when IPC/notification also throw');
      equal(f.unregistered.length, 1, 'throwing enqueue cannot poison Tauri sequence advancement'); checks++;
    }
    {
      const f = fixture(); f.deliver(f.frame(1, 'old', 6)); f.deliver(f.frame(1, 'current'));
      equal(f.writes.length, 1, 'stale generation does not consume current sequence');
      f.parse(); await settle(); equal(f.ackSequences(), [1], 'fresh generation retains a usable ACK window'); checks++;
    }
    {
      const f = fixture(); const bytes = new Uint8Array(f.frame(1));
      const padded = new Uint8Array(bytes.length + 6); padded.set(bytes, 3);
      f.deliver(padded.subarray(3, 3 + bytes.length)); f.parse(); await settle();
      equal(f.ackSequences(), [1], 'typed-array views preserve exact header and payload bounds'); checks++;
    }
    {
      const f = fixture();
      f.deliver(f.frame(1, 'x'.repeat(frames.TERMINAL_OUTPUT_MAX_DATA_BYTES)));
      equal(f.writes[0].data.byteLength, 16 * 1024, 'maximum native payload fits exactly');
      f.parse(); await settle(); equal(f.ackSequences(), [1], 'maximum frame receives ordinary parser credit'); checks++;
    }
    {
      const f = fixture(); f.deliver(f.frame(1)); f.deliver(f.frame(2));
      const outOfOrder = f.writes.pop()!; outOfOrder.done(); await settle();
      equal(f.faults().length, 1, 'non-contiguous parse completion cannot release unparsed output');
      equal(f.ackSequences(), [], 'future parser callbacks never create credit'); checks++;
    }
    console.log(`Terminal output parser-credit checks passed (${checks}).`);
  } finally {
    if (previousWindow) globalThis.window = previousWindow;
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
