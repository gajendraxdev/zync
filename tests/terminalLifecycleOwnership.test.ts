import type { attachTerminalLifecycleListeners, TerminalLifecycleEvent } from '../src/lib/terminal/terminalLifecycleListeners';
import type { TerminalCache } from '../src/lib/terminal/terminalCache';
import type * as PtyLifecycle from '../src/lib/terminal/ptyLifecycle';
import * as spawnErrors from '../src/lib/terminal/terminalSpawnErrors';

type Listeners = { attachTerminalLifecycleListeners: typeof attachTerminalLifecycleListeners };

function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`);
}

/** Exercise registered production listeners, including generation reuse after webview reload. */
export function runLifecycleOwnershipChecks(
  loadListeners: (dependencies: Record<string, unknown>) => Listeners,
): void {
  let checks = 0;
  function fixture() {
    const callbacks = new Map<string, (event: { payload: TerminalLifecycleEvent }) => void>();
    const ready: number[] = [];
    const cleanup: string[] = [];
    const entry = {
      term: {}, generation: 4, spawned: true, starting: true, listenerAttached: false,
      outputChannel: { id: 22 },
    } as TerminalCache;
    const cache = new Map([['session', entry]]);
    const listeners = loadListeners({
      '@tauri-apps/api/event': { listen: (name: string, callback: (event: { payload: TerminalLifecycleEvent }) => void) => {
        callbacks.set(name, callback); return Promise.resolve(() => {});
      } },
      './inputQueue.js': { clearTerminalInputQueue: () => cleanup.push('input queue') },
      './inputPipeline.js': { handleTerminalReady: (_id: string, generation: number) => ready.push(generation) },
      './terminalCache.js': { terminalCache: cache, clearTerminalPendingInput: () => cleanup.push('pending input') },
      './terminalIdleSuspendNotice.js': { writeIdleHostSuspendNotice: () => cleanup.push('idle notice') },
      './terminalResizeSync.js': { clearTerminalResizeState: () => cleanup.push('resize') },
      './terminalService.js': { terminalService: { closeTabOnShellExit: () => cleanup.push('close tab') } },
    });
    listeners.attachTerminalLifecycleListeners('session', entry.term);
    return { entry, cache, ready, cleanup,
      emit: (kind: 'ready' | 'exit', event: TerminalLifecycleEvent) => callbacks.get(`terminal-${kind}-session`)?.({ payload: event }),
    };
  }
  {
    const f = fixture();
    f.emit('ready', { generation: 4, channel_id: 21 });
    equal(f.ready, [], 'old ready cannot release input to a same-generation replacement');
    f.emit('ready', { generation: 4, channel_id: 22 });
    equal(f.ready, [4], 'current owner reaches the generation-aware ready handler'); checks++;
  }
  {
    const f = fixture();
    f.emit('exit', { generation: 4, channel_id: 21 });
    equal(f.entry.spawned, true, 'old exit cannot mark a replacement shell closed');
    equal(f.cleanup, [], 'old exit cannot clear replacement input/resize or close its tab');
    f.emit('exit', { generation: 4, channel_id: 22 });
    equal(f.entry.spawned, false, 'matching exit marks the actual shell closed');
    equal(f.cleanup, ['pending input', 'input queue', 'resize', 'close tab'], 'matching exit reuses ordinary cleanup'); checks++;
  }
  {
    const f = fixture(); f.entry.suspendedByIdle = true;
    f.emit('exit', { generation: 3, channel_id: 21 });
    equal(f.cleanup, [], 'idle gen-minus-one exception does not bypass channel ownership');
    f.emit('exit', { generation: 3, channel_id: 22 });
    equal(f.cleanup, ['pending input', 'input queue', 'resize', 'idle notice'], 'matching idle exit retains existing banner semantics'); checks++;
  }
  {
    const f = fixture();
    f.emit('exit', { generation: 3, channel_id: 22 });
    equal(f.cleanup, [], 'matching channel still rejects stale ordinary generations'); checks++;
  }
  {
    const f = fixture();
    f.cache.set('session', { ...f.entry, outputChannel: { id: 23 } } as TerminalCache);
    f.emit('ready', { generation: 4, channel_id: 22 }); f.emit('exit', { generation: 4, channel_id: 22 });
    equal([f.ready, f.cleanup], [[], []], 'old listeners cannot apply old-channel events to a replaced cache entry'); checks++;
  }
  {
    const f = fixture(); f.emit('ready', { generation: 4 }); f.emit('exit', { generation: 4 });
    equal(f.ready, [4], 'legacy browser ready fixtures remain supported');
    equal(f.cleanup.at(-1), 'close tab', 'legacy generation-only exit fixtures retain their semantics'); checks++;
  }
  console.log(`Terminal lifecycle channel-ownership checks passed (${checks}).`);
}

/** A late native create rejection cannot report an error against a replacement shell. */
export async function runSpawnOwnershipChecks(
  loadLifecycle: (dependencies: Record<string, unknown>, globals: Record<string, unknown>) => typeof PtyLifecycle,
): Promise<void> {
  let checks = 0;
  function fixture(connectionId = 'local') {
    const writes: string[] = [];
    const logs: unknown[] = [];
    const term = { rows: 24, cols: 80, clear() {}, reset() {}, write: (text: string) => writes.push(text) } as unknown as TerminalCache['term'];
    const entry = { term, generation: 0, spawned: false, starting: false, pendingInput: '', pendingInputBytes: 0,
      inputFlushTimer: null } as TerminalCache;
    const cache = new Map([['session', entry]]);
    const creates: { args: { generation: number }; reject: (error: unknown) => void }[] = [];
    let channelId = 0;
    const lifecycle = loadLifecycle({
      './connectionBackend.js': { isConnectionBackendLive: () => true },
      './inputQueue.js': { clearTerminalInputQueue() {} },
      './terminalCache.js': { terminalCache: cache, clearTerminalPendingInput() {}, invalidateTerminalGhostCwd() {} },
      './terminalSpawnErrors.js': spawnErrors,
      './terminalIdleSuspendNotice.js': { clearIdleHostSuspendNotice() {}, writeIdleHostSuspendNotice() {} },
      './terminalOutputStream.js': { attachTerminalOutputChannel: (id: string) => {
        const channel = { id: ++channelId } as TerminalCache['outputChannel'];
        cache.get(id)!.outputChannel = channel;
        return channel;
      } },
      './terminalResizeSync.js': { clearTerminalResizeState() {} },
    }, {
      window: { ipcRenderer: { send() {}, invoke: (_command: string, args: { generation: number }) =>
        new Promise<void>((_resolve, reject) => { creates.push({ args, reject }); }) } },
      console: { error: (...args: unknown[]) => logs.push(args) },
    });
    return { lifecycle, cache, entry, term, creates, writes, logs,
      spawn: () => lifecycle.spawnTerminalSession({ termId: 'session', connectionId, term: cache.get('session')!.term }),
      settle: async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); },
    };
  }
  for (const transition of ['reset', 'suspend']) {
    const f = fixture('remote'); f.spawn();
    if (transition === 'reset') f.lifecycle.resetTerminalPtyForReconnect('session');
    else f.lifecycle.suspendTerminalPty('session');
    f.spawn();
    equal(f.creates.map(create => create.args.generation), [1, 3], `${transition} starts a distinct native generation`);
    const replacementState = [f.entry.spawned, f.entry.starting, f.entry.spawnBlocked];
    f.creates[0].reject('CONNECTION_NOT_READY:remote'); await f.settle();
    equal([f.writes, f.logs], [[], []], `${transition}: obsolete failure produces no red text or error log`);
    equal([f.entry.spawned, f.entry.starting], [true, true], `${transition}: replacement remains starting`);
    equal([f.entry.spawned, f.entry.starting, f.entry.spawnBlocked], replacementState, `${transition}: new spawn state is untouched`); checks++;
  }
  {
    const f = fixture(); f.spawn();
    const replacement = { ...f.entry, generation: 0, spawned: false, starting: false };
    f.cache.set('session', replacement); f.spawn();
    equal(f.creates.map(create => create.args.generation), [1, 1], 'webview-style replacement can reuse a generation');
    f.creates[0].reject('obsolete owner'); await f.settle();
    equal([f.writes, f.logs], [[], []], 'cache identity rejects same-generation stale errors');
    equal([replacement.spawned, replacement.starting], [true, true], 'replacement cache state stays starting'); checks++;
  }
  {
    const f = fixture(); f.spawn();
    f.entry.generation = 0; f.entry.spawned = false; f.entry.starting = false; f.spawn();
    f.creates[0].reject('obsolete channel'); await f.settle();
    equal([f.writes, f.logs], [[], []], 'channel identity also fences same-object generation reuse');
    equal([f.entry.spawned, f.entry.starting], [true, true], 'new channel remains live and starting'); checks++;
  }
  {
    const f = fixture(); f.spawn();
    f.entry.term = { ...f.term } as TerminalCache['term'];
    f.creates[0].reject('disposed xterm'); await f.settle();
    equal([f.writes, f.logs], [[], []], 'replaced xterm is not written by an obsolete catch'); checks++;
  }
  {
    const f = fixture(); f.spawn(); f.cache.delete('session');
    f.creates[0].reject('closed tab'); await f.settle();
    equal([f.writes, f.logs], [[], []], 'closed tab failures do not write to disposed xterm'); checks++;
  }
  {
    const f = fixture(); f.spawn(); f.creates[0].reject('current fixture failure'); await f.settle();
    equal([f.writes.length, f.logs.length], [1, 1], 'current creation error still has one visible/reporting owner');
    equal(f.writes[0].includes('Failed to start terminal session: current fixture failure'), true, 'current error text remains actionable');
    equal([f.entry.spawned, f.entry.starting], [false, false], 'current failed spawn releases its state'); checks++;
  }
  {
    const f = fixture('remote'); f.spawn(); f.creates[0].reject('CONNECTION_NOT_READY:remote'); await f.settle();
    equal([f.writes.length, f.logs.length, f.entry.spawnBlocked], [1, 1, true], 'current missing connection still blocks respawn');
    equal(f.writes[0].includes('CONNECTION_NOT_READY'), false, 'current readiness failure retains friendly formatting'); checks++;
  }
  console.log(`Terminal spawn-rejection ownership checks passed (${checks}).`);
}
