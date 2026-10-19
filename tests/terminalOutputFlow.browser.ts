import { Terminal } from '@xterm/xterm';
import type { Channel } from '@tauri-apps/api/core';
import { attachTerminalOutputChannel } from '../src/lib/terminal/terminalOutputStream';
import { terminalCache, type TerminalCache } from '../src/lib/terminal/terminalCache';
import { silenceTerminalOutputChannel } from '../src/lib/terminal/terminalReloadTeardown';
import { bindNotifyDispatcher } from '../src/features/notifications/notify';

const WINDOW_BYTES = 256 * 1024;
const MAX_PAYLOAD = 16 * 1024;
const MAX_FRAMES = 64;
const MiB = 1024 * 1024;
const encoder = new TextEncoder();
const pattern = encoder.encode(`${'0123456789abcdef'.repeat(4).slice(0, 62)}\r\n`.repeat(256));
const callbacks = new Map<number, (message: unknown) => void>();
const errors: string[] = [];
let nextCallback = 0;
let native: Producer | undefined;

/** Browser-side credit simulation only; output ordering/ACK policy stays in production source. */
const bridgeWindow = window as unknown as {
  __TAURI_INTERNALS__: {
    transformCallback(callback: (message: unknown) => void): number;
    unregisterCallback(id: number): void;
    invoke(command: string, args: Record<string, unknown>): Promise<unknown>;
  };
  runOutputFlowBrowserChecks: () => Promise<unknown>;
};
bridgeWindow.__TAURI_INTERNALS__ = {
  transformCallback(callback) { callbacks.set(++nextCallback, callback); return nextCallback; },
  unregisterCallback(id) { callbacks.delete(id); },
  invoke(command, args) {
    if (command === 'terminal_ack_output' && native) return native.acknowledge(args);
    if (command === 'terminal_output_failed') { errors.push('production output fault'); native?.close(); return Promise.resolve(); }
    return Promise.reject(new Error(`Unexpected fixture command ${command}`));
  },
};
bindNotifyDispatcher((_type, message) => { errors.push(message); });

/** Ordered noncryptographic streaming checksum; no entire-output allocation is retained. */
function hashBytes(hash: number, bytes: Uint8Array): number {
  for (let index = 0; index < bytes.length; index++) hash = Math.imul(hash ^ bytes[index], 16777619);
  return hash >>> 0;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** Simulate the bounded native sender, not the frontend parser-credit implementation. */
class Producer {
  readonly marker: string;
  readonly done: Promise<void>;
  private finish!: () => void;
  private sequence = 0;
  private acknowledged = 0;
  private generated = 0;
  private finalSent = false;
  private closed = false;
  private frames: { sequence: number; wireBytes: number }[] = [];
  private outstanding = 0;
  private activeAcks = 0;
  peakOutstanding = 0;
  peakAckInvokes = 0;
  expectedBytes = 0;
  expectedHash = 2166136261;
  ackInvokes = 0;

  constructor(readonly id: string, readonly channel: Channel, readonly total: number, readonly asynchronous: boolean) {
    this.marker = `ZYNC_OUTPUT_FLOW_DONE_${id}`;
    this.done = new Promise(resolve => { this.finish = resolve; });
  }

  /** Create only a small next chunk after its wire capacity is available. */
  pump(): void {
    while (!this.closed && !this.finalSent && this.frames.length < MAX_FRAMES) {
      const final = this.generated >= this.total;
      const prefix = !final && this.asynchronous && this.sequence % 32 === 0 ? encoder.encode('\x1b]777;delay\x07') : new Uint8Array();
      const count = final ? 0 : Math.min(MAX_PAYLOAD - prefix.length, this.total - this.generated);
      const marker = final ? encoder.encode(`\r\n${this.marker}\r\n`) : undefined;
      const length = marker?.length ?? prefix.length + count;
      if (this.outstanding + length + 8 > WINDOW_BYTES) return;
      const bytes = marker ?? new Uint8Array(length);
      if (!marker) {
        bytes.set(prefix); bytes.set(pattern.subarray(0, count), prefix.length);
        const identity = encoder.encode(`frame-${this.sequence + 1}`);
        bytes.set(identity.subarray(0, count), prefix.length);
        this.generated += count;
      }
      const sequence = ++this.sequence;
      const frame = new Uint8Array(bytes.length + 8);
      const header = new DataView(frame.buffer);
      header.setUint32(0, 1, true); header.setUint32(4, sequence, true); frame.set(bytes, 8);
      this.expectedBytes += bytes.length;
      this.expectedHash = hashBytes(this.expectedHash, bytes);
      this.frames.push({ sequence, wireBytes: frame.length });
      this.outstanding += frame.length;
      this.peakOutstanding = Math.max(this.peakOutstanding, this.outstanding);
      this.finalSent = final;
      const callback = callbacks.get(this.channel.id);
      assert(callback, 'installed Tauri channel callback must remain registered');
      callback({ index: sequence - 1, message: frame.buffer });
    }
  }

  /** Return cumulative native credit after a simulated asynchronous IPC round trip. */
  async acknowledge(args: Record<string, unknown>): Promise<void> {
    assert(args.termId === this.id && args.generation === 1 && args.channelId === this.channel.id, 'ACK must retain exact native identity');
    this.peakAckInvokes = Math.max(this.peakAckInvokes, ++this.activeAcks);
    this.ackInvokes++;
    try {
      await delay(1);
      if (this.closed) return;
      const sequence = args.sequence as number;
      assert(Number.isInteger(sequence) && sequence > this.acknowledged && sequence <= this.sequence, 'ACK must be a valid monotonic sent frontier');
      this.acknowledged = sequence;
      while (this.frames.length && this.frames[0].sequence <= sequence) this.outstanding -= this.frames.shift()!.wireBytes;
      this.pump();
      if (this.finalSent && this.frames.length === 0) {
        callbacks.get(this.channel.id)?.({ index: this.sequence, end: true });
        this.finish();
      }
    } finally { this.activeAcks--; }
  }

  /** Explicit disposal cancels credit waits without inventing parser acknowledgments. */
  close(): void {
    this.closed = true;
    this.frames = [];
    silenceTerminalOutputChannel(this.channel);
    callbacks.get(this.channel.id)?.({ index: this.sequence, end: true });
    terminalCache.delete(this.id);
    this.finish();
  }
}

/** Collect bounded event-loop latency samples alongside actual xterm parsing. */
async function runCase(name: string, bytes: number, options: { hidden?: boolean; asynchronous?: boolean } = {}) {
  const host = document.createElement('div');
  host.style.cssText = 'width:900px;height:320px'; document.body.append(host);
  const term = new Terminal({ cols: 100, rows: 24, scrollback: 500, cursorBlink: false });
  term.open(host);
  const originalRaf = window.requestAnimationFrame;
  const originalCancelRaf = window.cancelAnimationFrame;
  let receivedBytes = 0;
  let parsedBytes = 0;
  let receivedHash = 2166136261;
  let parsedHash = 2166136261;
  let controls = 0;
  let asyncPauses = 0;
  const timerSamples: number[] = [];
  const originalWrite = term.write.bind(term);
  term.write = (data, done) => {
    assert(data instanceof Uint8Array, 'production output must remain binary');
    receivedBytes += data.length; receivedHash = hashBytes(receivedHash, data);
    originalWrite(data, () => {
      parsedBytes += data.length; parsedHash = hashBytes(parsedHash, data); done?.();
    });
  };
  term.onData(() => { controls++; });
  const parser = term.parser.registerOscHandler(777, async () => { asyncPauses++; await delay(4); return false; });
  terminalCache.set(name, { term, generation: 1, spawned: true, ghostContextActive: false } as TerminalCache);
  const channel = attachTerminalOutputChannel(name, term);
  const producer = native = new Producer(name, channel, bytes, Boolean(options.asynchronous));
  let previousTick = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    if (timerSamples.length < 4096) timerSamples.push(Math.max(0, now - previousTick - 8));
    previousTick = now;
    term.input('\x03', true);
  }, 8);
  if (options.hidden) {
    host.style.display = 'none';
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
  }
  const started = performance.now();
  try {
    producer.pump();
    await Promise.race([producer.done, delay(120_000).then(() => { throw new Error(`${name}: parser-credit drain timed out`); })]);
    const elapsedMs = performance.now() - started;
    assert(receivedBytes === producer.expectedBytes && parsedBytes === producer.expectedBytes, `${name}: every generated byte must reach xterm and its parse callback`);
    assert(receivedHash === producer.expectedHash && parsedHash === producer.expectedHash, `${name}: ordered streaming checksums must match`);
    assert(producer.peakOutstanding <= WINDOW_BYTES, `${name}: pending native wire data must stay bounded`);
    assert(producer.peakAckInvokes === 1, `${name}: production ACKs must never overlap`);
    const buffer = term.buffer.active;
    const tail = Array.from({ length: Math.min(buffer.length, 30) }, (_, index) => buffer.getLine(buffer.length - 1 - index)?.translateToString() ?? '').join('\n');
    assert(tail.includes(producer.marker), `${name}: final marker must be present in xterm's actual parsed buffer`);
    assert(!callbacks.has(channel.id), `${name}: final channel end must be delivered after ACK drain`);
    assert(controls > 0, `${name}: event loop and input callbacks must keep progressing`);
    if (options.asynchronous) assert(asyncPauses > 0, 'async parser path must actually pause');
    timerSamples.sort((left, right) => left - right);
    return { name, payloadMiB: Number((parsedBytes / MiB).toFixed(2)), elapsedMs: Number(elapsedMs.toFixed(1)),
      throughputMiBPerSecond: Number((parsedBytes / MiB / (elapsedMs / 1000)).toFixed(2)),
      peakPendingWireBytes: producer.peakOutstanding, maxAckInvokesInFlight: producer.peakAckInvokes, ackInvokes: producer.ackInvokes,
      parsedFNV1a32: parsedHash.toString(16).padStart(8, '0'), inputCallbacks: controls, asyncParserPauses: asyncPauses,
      eventLoopSamples: timerSamples.length, eventLoopP95DelayMs: Number((timerSamples[Math.floor(timerSamples.length * 0.95)] ?? 0).toFixed(2)),
      eventLoopMaxDelayMs: Number((timerSamples.at(-1) ?? 0).toFixed(2)), hiddenNoAnimationFrames: Boolean(options.hidden) };
  } finally {
    clearInterval(timer);
    window.requestAnimationFrame = originalRaf; window.cancelAnimationFrame = originalCancelRaf;
    producer.close(); parser.dispose(); term.dispose(); host.remove(); native = undefined;
  }
}

/** Keep a parser deliberately stopped, then dispose without waiting for more credit. */
async function closeBusyCase() {
  const host = document.createElement('div'); host.style.cssText = 'width:900px;height:320px'; document.body.append(host);
  const term = new Terminal({ cols: 100, rows: 24, scrollback: 500 }); term.open(host);
  let release!: (value: boolean) => void;
  const paused = new Promise<boolean>(resolve => { release = resolve; });
  let parserEntered!: () => void;
  const parsing = new Promise<void>(resolve => { parserEntered = resolve; });
  term.parser.registerOscHandler(777, () => { parserEntered(); return paused; });
  const id = 'close_busy';
  terminalCache.set(id, { term, generation: 1, spawned: true } as TerminalCache);
  const producer = native = new Producer(id, attachTerminalOutputChannel(id, term), 64 * MiB, true);
  producer.pump();
  try {
    await Promise.race([parsing, delay(5000).then(() => { throw new Error('async parser did not stop'); })]);
    const started = performance.now();
    producer.close(); await producer.done;
    const elapsedMs = performance.now() - started;
    assert(elapsedMs < 1000, 'explicit close must not await the stalled parser');
    assert(producer.expectedBytes < producer.total, 'the producer must actually have been blocked mid-stream');
    release(false); await delay(20);
    return { name: id, closeMs: Number(elapsedMs.toFixed(2)), pendingWireBeforeClose: producer.peakOutstanding };
  } finally { release(false); producer.close(); term.dispose(); host.remove(); native = undefined; }
}

/** Qualify the real browser/parser boundary, not SSH speed or total installed-app memory. */
bridgeWindow.runOutputFlowBrowserChecks = async () => {
  const results = [await runCase('visible_64MiB', 64 * MiB), await runCase('hidden_no_raf_16MiB', 16 * MiB, { hidden: true }),
    await runCase('async_parser_16MiB', 16 * MiB, { asynchronous: true }), await closeBusyCase()];
  assert(errors.length === 0, `no transport/notification failures expected: ${errors.join('; ')}`);
  assert(terminalCache.size === 0 && callbacks.size === 0, 'fixture terminals and Tauri callbacks must be released');
  return { browser: navigator.userAgent, conditions: 'real DOM xterm, 500-row scrollback, incremental FNV hash checks, simulated 1ms ACK IPC; not installed-app/SSH/release profiling', results };
};
