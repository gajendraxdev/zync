/**
 * Optional PTY I/O counters for throughput QA.
 * Enable with localStorage.zyncTerminalIoDebug = '1'. Never logs payloads.
 */

const FLAG = 'zyncTerminalIoDebug';
const DUMP_MS = 1000;
const FLAG_POLL_MS = 1000;
const WRITES_PER_FRAME_CAP = 600;

let cachedEnabled = false;
let lastFlagCheck = 0;

export function isTerminalIoDebugEnabled(): boolean {
  const now = Date.now();
  if (now - lastFlagCheck < FLAG_POLL_MS) {
    return cachedEnabled;
  }
  lastFlagCheck = now;
  try {
    cachedEnabled = typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1';
  } catch {
    cachedEnabled = false;
  }
  return cachedEnabled;
}

interface SessionIoStats {
  startedAt: number;
  framesIn: number;
  termWrites: number;
  bytesIn: number;
  termWriteTotalMs: number;
  termWriteMaxMs: number;
  maxPendingBytes: number;
  writesThisFrame: number;
  writesPerFrame: number[];
  frameRaf: number | null;
  dumpTimer: ReturnType<typeof setInterval> | null;
}

const sessions = new Map<string, SessionIoStats>();

function getSession(termId: string): SessionIoStats {
  let stats = sessions.get(termId);
  if (!stats) {
    stats = {
      startedAt: Date.now(),
      framesIn: 0,
      termWrites: 0,
      bytesIn: 0,
      termWriteTotalMs: 0,
      termWriteMaxMs: 0,
      maxPendingBytes: 0,
      writesThisFrame: 0,
      writesPerFrame: [],
      frameRaf: null,
      dumpTimer: null,
    };
    sessions.set(termId, stats);
  }
  return stats;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? 0;
}

function dumpSession(termId: string, stats: SessionIoStats): void {
  const elapsedSec = Math.max(0.001, (Date.now() - stats.startedAt) / 1000);
  const sorted = [...stats.writesPerFrame].sort((a, b) => a - b);
  const median = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const writesPerSec = stats.termWrites / elapsedSec;
  const framesPerSec = stats.framesIn / elapsedSec;

  const line = {
    termId,
    framesIn: stats.framesIn,
    termWrites: stats.termWrites,
    bytesIn: stats.bytesIn,
    termWriteTotalMs: Number(stats.termWriteTotalMs.toFixed(2)),
    termWriteMaxMs: Number(stats.termWriteMaxMs.toFixed(2)),
    maxPendingBytes: stats.maxPendingBytes,
    writesPerSec: Number(writesPerSec.toFixed(1)),
    framesPerSec: Number(framesPerSec.toFixed(1)),
    writesPerFrameMedian: median,
    writesPerFrameP95: p95,
  };

  const ipc = (window as Window & {
    ipcRenderer?: { invoke: (ch: string, ...args: unknown[]) => Promise<unknown> };
  }).ipcRenderer;
  if (!ipc?.invoke) {
    console.debug('[zync-terminal-io]', line);
    return;
  }
  void ipc.invoke('terminal:flush-stats').then(
    (flushReasons) => {
      console.debug('[zync-terminal-io]', { ...line, rustFlushReasonsProcessWide: flushReasons });
    },
    () => {
      console.debug('[zync-terminal-io]', line);
    },
  );
}

function pumpVsync(termId: string, stats: SessionIoStats): void {
  if (stats.frameRaf !== null || typeof requestAnimationFrame === 'undefined') return;
  const tick = () => {
    stats.writesPerFrame.push(stats.writesThisFrame);
    if (stats.writesPerFrame.length > WRITES_PER_FRAME_CAP) {
      stats.writesPerFrame.shift();
    }
    stats.writesThisFrame = 0;
    if (!sessions.has(termId) || !isTerminalIoDebugEnabled()) {
      stats.frameRaf = null;
      return;
    }
    stats.frameRaf = requestAnimationFrame(tick);
  };
  stats.frameRaf = requestAnimationFrame(tick);
}

function ensureDump(termId: string, stats: SessionIoStats): void {
  if (stats.dumpTimer !== null) return;
  stats.dumpTimer = setInterval(() => {
    if (!isTerminalIoDebugEnabled()) {
      clearTerminalIoDebug(termId);
      return;
    }
    dumpSession(termId, stats);
  }, DUMP_MS);
  pumpVsync(termId, stats);
}

export function recordChannelFrame(termId: string, payloadBytes: number): void {
  if (!isTerminalIoDebugEnabled()) return;
  const stats = getSession(termId);
  stats.framesIn += 1;
  stats.bytesIn += payloadBytes;
  if (payloadBytes > stats.maxPendingBytes) stats.maxPendingBytes = payloadBytes;
  ensureDump(termId, stats);
}

export function recordTermWrite(termId: string, durationMs: number): void {
  if (!isTerminalIoDebugEnabled()) return;
  const stats = getSession(termId);
  stats.termWrites += 1;
  stats.termWriteTotalMs += durationMs;
  if (durationMs > stats.termWriteMaxMs) stats.termWriteMaxMs = durationMs;
  stats.writesThisFrame += 1;
  ensureDump(termId, stats);
}

export function clearTerminalIoDebug(termId: string): void {
  const stats = sessions.get(termId);
  if (!stats) return;
  if (stats.dumpTimer !== null) clearInterval(stats.dumpTimer);
  if (stats.frameRaf !== null && typeof cancelAnimationFrame !== 'undefined') {
    cancelAnimationFrame(stats.frameRaf);
  }
  sessions.delete(termId);
}

export function clearAllTerminalIoDebug(): void {
  for (const termId of [...sessions.keys()]) {
    clearTerminalIoDebug(termId);
  }
}
