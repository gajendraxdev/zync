import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePluginTerminalLaunch } from '../.tmp-agent-tests/src/features/plugins/terminal/launch.js';
import { PluginTerminalSessionService } from '../.tmp-agent-tests/src/features/plugins/terminal/sessionService.js';
import { allocateTerminalSurface, parseTerminalSurfaceRect } from '../.tmp-agent-tests/src/features/plugins/terminal/surfaceGeometry.js';

const owner = Object.freeze({
  runtimeInstanceId: 'runtime-a', paneInstanceId: 'pane-a',
  frameGeneration: 1, connectionToken: 'binding-a:1',
});
const launch = Object.freeze({
  program: 'example-tool', args: ['interactive', "a'; $(not-a-shell)"],
  expectedConnectionToken: owner.connectionToken,
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}, limits) {
  const calls = [];
  const transport = { close: async () => { calls.push('close'); } };
  const dependencies = {
    isCurrent: () => true,
    prepare: async (snapshot, proposal, signal) => {
      calls.push(['prepare', snapshot, proposal, signal]);
      return 'native-authority';
    },
    confirm: async () => { calls.push('confirm'); return true; },
    create: async (authority, signal) => { calls.push(['create', authority, signal]); return transport; },
    attach: session => { calls.push(['attach', session.id]); },
    detach: session => { calls.push(['detach', session.id]); },
    ...overrides,
  };
  const service = new PluginTerminalSessionService(dependencies, limits);
  return { service, calls, dependencies, transport };
}

// Reach async barriers without wall-clock sleeps, a live host, or network I/O.
async function turn() { for (let i = 0; i < 5; i++) await Promise.resolve(); }

test('launch snapshots arguments without mutating or interpreting them', () => {
  const proposal = { ...launch, args: [...launch.args] };
  const parsed = parsePluginTerminalLaunch(proposal);
  proposal.args[0] = 'changed-after-approval';
  assert.equal(parsed.args[0], 'interactive');
  assert.equal(parsed.args[1], "a'; $(not-a-shell)");
  assert.ok(Object.isFrozen(parsed));
  assert.ok(Object.isFrozen(parsed.args));
  assert.throws(() => { parsed.args.push('injected'); }, TypeError);
});

test('launch rejects ambient authority, invalid types and controls', () => {
  const bad = [null, [], '', {},
    { ...launch, connectionId: 'different-host' },
    { ...launch, terminalId: 'existing-workspace-shell' },
    { ...launch, env: { TOKEN: 'secret' } },
    { ...launch, stdin: 'silently-run-this\r' },
    { ...launch, program: '' }, { ...launch, program: '  ' },
    { ...launch, program: '-flag' }, { ...launch, program: 'bad\nprogram' },
    { ...launch, args: [1] }, { ...launch, args: 'text' },
    { ...launch, args: ['\0'] }, { ...launch, args: ['\u0085'] },
    { ...launch, expectedConnectionToken: '' },
    { ...launch, expectedConnectionToken: 'token\n' },
    { ...launch, expectedConnectionToken: 'x'.repeat(257) },
  ];
  for (const proposal of bad) assert.throws(() => parsePluginTerminalLaunch(proposal));
});

test('launch bounds argv count and UTF-8 bytes, allowing empty arguments', () => {
  assert.deepEqual(parsePluginTerminalLaunch({ ...launch, args: [''] }).args, ['']);
  assert.equal(parsePluginTerminalLaunch({ ...launch, args: Array(64).fill('') }).args.length, 64);
  assert.throws(() => parsePluginTerminalLaunch({ ...launch, args: Array(65).fill('') }));
  assert.throws(() => parsePluginTerminalLaunch({ ...launch, args: ['€'.repeat(6000)] }));
  assert.doesNotThrow(() => parsePluginTerminalLaunch({ ...launch, program: 'x', args: ['a'.repeat(16383)] }));
  assert.throws(() => parsePluginTerminalLaunch({ ...launch, program: 'x', args: ['a'.repeat(16384)] }));
});

test('surface parser rejects forged CSS, NaN, infinity, excessive and empty slots', () => {
  const rect = { x: 10, y: 20, width: 200, height: 100 };
  assert.deepEqual(parseTerminalSurfaceRect(rect), rect);
  for (const bad of [null, [], {}, { ...rect, x: '10' }, { ...rect, x: NaN },
    { ...rect, y: Infinity }, { ...rect, width: 0 }, { ...rect, height: -1 },
    { ...rect, x: 16385 }, { ...rect, zIndex: 99999 }, { ...rect, transform: 'scale(2)' }]) {
    assert.equal(parseTerminalSurfaceRect(bad), null);
  }
});

test('surface clips to pane while retaining full terminal dimensions and offsets', () => {
  const slot = { x: -20, y: -10, width: 200, height: 100 };
  assert.deepEqual(allocateTerminalSurface(slot, { width: 150, height: 60 }), {
    terminal: slot, clip: { x: 0, y: 0, width: 150, height: 60 }, offset: { x: -20, y: -10 },
  });
  assert.deepEqual(allocateTerminalSurface({ x: 100, y: 50, width: 200, height: 100 }, { width: 150, height: 80 }).clip,
    { x: 100, y: 50, width: 50, height: 30 });
});

test('fully clipped, hidden or invalid viewports do not allocate a surface', () => {
  const slot = { x: 100, y: 100, width: 200, height: 100 };
  for (const viewport of [{ width: 50, height: 50 }, { width: 0, height: 100 },
    { width: NaN, height: 100 }, { width: 100, height: Infinity }]) {
    assert.equal(allocateTerminalSurface(slot, viewport), null);
  }
  assert.equal(allocateTerminalSurface({ x: -100, y: -100, width: 20, height: 20 }, { width: 100, height: 100 }), null);
});

test('authorize then confirm then create; session closes and detaches exactly once', async () => {
  const { service, calls } = fixture();
  const session = await service.open(owner, launch);
  assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ['prepare', 'confirm', 'create', 'attach']);
  assert.equal(calls[2][1], 'native-authority');
  assert.equal(service.size, 1);
  assert.ok(Object.isFrozen(session.owner));
  await Promise.all([session.close(), session.close(), service.closeOwner(owner)]);
  assert.equal(service.size, 0);
  assert.equal(calls.filter(call => call === 'close').length, 1);
  assert.equal(calls.filter(call => Array.isArray(call) && call[0] === 'detach').length, 1);
  await session.close();
});

test('denied permission or user approval never creates a terminal', async () => {
  for (const overrides of [
    { prepare: async () => { throw new Error('Permission denied'); } },
    { confirm: async () => false },
  ]) {
    const { service, calls } = fixture(overrides);
    await assert.rejects(service.open(owner, launch), /denied|not approved/);
    assert.ok(!calls.some(call => Array.isArray(call) && call[0] === 'create'));
    assert.equal(service.size, 0);
  }
});

test('proposal and owner are snapshotted before asynchronous confirmation', async () => {
  const pending = deferred();
  const mutableOwner = { ...owner };
  const mutableLaunch = { ...launch, args: [...launch.args] };
  let approvedLaunch;
  const { service, calls } = fixture({
    prepare: () => pending.promise,
    confirm: async (_owner, proposal) => { approvedLaunch = proposal; return true; },
  });
  const opened = service.open(mutableOwner, mutableLaunch);
  mutableOwner.connectionToken = 'other-server';
  mutableLaunch.args[0] = 'different-command';
  pending.resolve('immutable-native-authority');
  const session = await opened;
  assert.equal(session.owner.connectionToken, owner.connectionToken);
  assert.equal(approvedLaunch.args[0], 'interactive');
  assert.equal(calls.find(call => Array.isArray(call) && call[0] === 'create')[1], 'immutable-native-authority');
  await service.dispose();
});

test('stale ownership and mismatched destination fail before native preflight', async () => {
  for (const [overrides, proposal] of [
    [{ isCurrent: () => false }, launch],
    [{}, { ...launch, expectedConnectionToken: 'other-connection' }],
  ]) {
    const { service, calls } = fixture(overrides);
    await assert.rejects(service.open(owner, proposal), /no longer current|connection changed/);
    assert.equal(calls.length, 0);
    assert.equal(service.size, 0);
  }
});

test('pending preflight consumes per-pane capacity and is canceled on frame close', async () => {
  const pending = deferred();
  let signal;
  const { service, calls } = fixture({ prepare: (_o, _l, abort) => { signal = abort; return pending.promise; } });
  const opened = assert.rejects(service.open(owner, launch), /canceled/);
  assert.equal(service.size, 1);
  await assert.rejects(service.open({ ...owner, frameGeneration: 2 }, launch), /limit/);
  const closed = service.closeOwner(owner);
  assert.ok(signal.aborted);
  assert.equal(service.size, 1, 'retain quota until the pending adapter settles');
  pending.resolve('authority');
  await Promise.all([opened, closed]);
  assert.equal(service.size, 0);
  assert.ok(!calls.includes('confirm'));
});

test('cancel while approval is pending cannot start a process', async () => {
  const pending = deferred();
  const { service, calls } = fixture({ confirm: () => pending.promise });
  const opened = assert.rejects(service.open(owner, launch), /canceled/);
  await turn();
  const closed = service.closeRuntime(owner.runtimeInstanceId);
  pending.resolve(true);
  await Promise.all([opened, closed]);
  assert.ok(!calls.some(call => Array.isArray(call) && call[0] === 'create'));
});

test('late native creation is closed, not attached, after document disposal', async () => {
  const pending = deferred();
  const { service, calls, transport } = fixture({ create: () => pending.promise });
  const opened = assert.rejects(service.open(owner, launch), /canceled/);
  await turn();
  const closed = service.closeOwner(owner);
  pending.resolve(transport);
  await Promise.all([opened, closed]);
  assert.equal(service.size, 0);
  assert.equal(calls.filter(call => call === 'close').length, 1);
  assert.ok(!calls.some(call => Array.isArray(call) && call[0] === 'attach'));
});

test('connection changes during create close the late result before returning', async () => {
  const pending = deferred();
  let current = true;
  const { service, calls, transport } = fixture({ isCurrent: () => current, create: () => pending.promise });
  const opened = assert.rejects(service.open(owner, launch), /no longer current/);
  await turn();
  current = false;
  pending.resolve(transport);
  await opened;
  assert.equal(calls.filter(call => call === 'close').length, 1);
  assert.equal(service.size, 0);
});

test('closing an old generation cannot close a replacement session', async () => {
  const { service, calls } = fixture();
  const first = await service.open(owner, launch);
  await first.close();
  const replacementOwner = { ...owner, frameGeneration: 2 };
  const replacement = await service.open(replacementOwner, launch);
  await service.closeOwner(owner);
  assert.equal(service.size, 1);
  assert.notEqual(first.id, replacement.id);
  assert.equal(calls.filter(call => call === 'close').length, 1);
  await replacement.close();
});

test('runtime and global limits count independent panes and pending reservations', async () => {
  const pending = deferred();
  const { service } = fixture({ prepare: () => pending.promise }, { total: 2, perRuntime: 1, perPane: 1 });
  const opened = service.open(owner, launch);
  await assert.rejects(service.open({ ...owner, paneInstanceId: 'pane-b' }, launch), /limit/);
  const secondOwner = { ...owner, runtimeInstanceId: 'runtime-b' };
  const second = service.open(secondOwner, launch);
  await assert.rejects(service.open({ ...owner, runtimeInstanceId: 'runtime-c' }, launch), /limit/);
  pending.resolve('authority');
  await Promise.all([opened, second]);
  await service.dispose();
});

test('closing sessions keep capacity until native shutdown completes', async () => {
  const pending = deferred();
  const { service } = fixture({ create: async () => ({ close: () => pending.promise }) });
  const session = await service.open(owner, launch);
  const closed = session.close();
  await assert.rejects(service.open(owner, launch), /limit/);
  assert.equal(service.size, 1);
  pending.resolve();
  await closed;
  assert.equal(service.size, 0);
});

test('a failed native close retains quota and supports explicit retry', async () => {
  let attempts = 0;
  const { service } = fixture({ create: async () => ({ close: async () => {
    if (++attempts === 1) throw new Error('Close failed');
  } }) });
  const session = await service.open(owner, launch);
  await assert.rejects(session.close(), /Close failed/);
  assert.equal(service.size, 1);
  await assert.rejects(service.open(owner, launch), /limit/);
  await session.close();
  assert.equal(attempts, 2);
  assert.equal(service.size, 0);
});

test('failed renderer attachment closes its native transport', async () => {
  const { service, calls } = fixture({ attach: () => { throw new Error('Renderer unavailable'); } });
  await assert.rejects(service.open(owner, launch), /Renderer unavailable/);
  assert.equal(calls.filter(call => call === 'close').length, 1);
  assert.equal(service.size, 0);
});

test('a detach exception cannot bypass native close', async () => {
  const { service, calls } = fixture({ detach: () => { throw new Error('Detach failed'); } });
  const session = await service.open(owner, launch);
  await assert.rejects(session.close(), /Detach failed/);
  assert.equal(calls.filter(call => call === 'close').length, 1);
  assert.equal(service.size, 0);
});

test('synchronous close during attach disposes exactly once and cannot return a live session', async () => {
  let closing;
  const { service, calls } = fixture({ attach: session => { closing = session.close(); } });
  await assert.rejects(service.open(owner, launch), /canceled/);
  await closing;
  assert.equal(calls.filter(call => call === 'close').length, 1);
  assert.equal(service.size, 0);
});

test('closing stale sessions follows host connection state, not pane visibility', async () => {
  let current = true;
  const { service } = fixture({ isCurrent: () => current });
  await service.open(owner, launch);
  await service.closeStale();
  assert.equal(service.size, 1);
  current = false;
  await service.closeStale();
  assert.equal(service.size, 0);
});

test('dispose closes all transports even if one fails; later opens are blocked', async () => {
  let closed = 0;
  const { service } = fixture({ create: async () => ({ close: async () => {
    closed++;
    if (closed === 1) throw new Error('One close failed');
  } }) });
  await service.open(owner, launch);
  await service.open({ ...owner, paneInstanceId: 'pane-b' }, launch);
  await assert.rejects(service.dispose(), /One close failed/);
  assert.equal(closed, 2);
  await assert.rejects(service.open(owner, launch), /disposed/);
  await service.dispose();
  assert.equal(service.size, 0);
});

test('invalid or externally mutated capacity policy cannot bypass bounds', async () => {
  for (const total of [0, -1, 1.5, Infinity, NaN]) {
    assert.throws(() => fixture({}, { total, perRuntime: 1, perPane: 1 }), /positive integers/);
  }
  const limits = { total: 1, perRuntime: 1, perPane: 1 };
  const { service } = fixture({}, limits);
  limits.total = limits.perRuntime = limits.perPane = 100;
  await service.open(owner, launch);
  await assert.rejects(service.open({ ...owner, paneInstanceId: 'pane-b' }, launch), /limit/);
  await service.dispose();
});

test('a reconnect during approval is rejected before native creation', async () => {
  let current = true;
  const { service, calls } = fixture({
    isCurrent: () => current,
    confirm: async () => { current = false; return true; },
  });
  await assert.rejects(service.open(owner, launch), /no longer current/);
  assert.ok(!calls.some(call => Array.isArray(call) && call[0] === 'create'));
  assert.equal(service.size, 0);
});

test('native creation failure releases its pending reservation', async () => {
  const { service } = fixture({ create: async () => { throw new Error('PTY could not open'); } });
  await assert.rejects(service.open(owner, launch), /PTY could not open/);
  assert.equal(service.size, 0);
});

test('late-create shutdown failures reach both callers and retain capacity for retry', async () => {
  const pending = deferred();
  let attempts = 0;
  const { service } = fixture({ create: () => pending.promise });
  const opened = assert.rejects(service.open(owner, launch), error => {
    assert.equal(error.name, 'PluginTerminalOpenError');
    assert.match(error.failures[0].message, /canceled/);
    assert.match(error.failures[1].message, /Native close failed/);
    return true;
  });
  await turn();
  const closed = assert.rejects(service.closeOwner(owner), /Native close failed/);
  pending.resolve({ close: async () => {
    if (++attempts === 1) throw new Error('Native close failed');
  } });
  await Promise.all([opened, closed]);
  assert.equal(service.size, 1);
  await service.dispose();
  assert.equal(attempts, 2);
  assert.equal(service.size, 0);
});

test('repeated independent open/close cycles do not retain sessions or reuse UI identity', async () => {
  const { service, calls } = fixture();
  let previousId = 0;
  for (let generation = 1; generation <= 100; generation++) {
    const session = await service.open({ ...owner, frameGeneration: generation }, launch);
    assert.ok(session.id > previousId);
    previousId = session.id;
    await session.close();
    assert.equal(service.size, 0);
  }
  assert.equal(calls.filter(call => call === 'close').length, 100);
  await service.dispose();
});

test('surface allocation never escapes its pane across fractional and scrolling rectangles', () => {
  for (let i = 1; i <= 1000; i++) {
    const slot = { x: (i % 311) - 150.25, y: (i % 127) - 75.5, width: (i % 257) + 0.5, height: (i % 83) + 0.25 };
    const viewport = { width: 120.5, height: 70.25 };
    const allocation = allocateTerminalSurface(slot, viewport);
    if (!allocation) continue;
    const { clip, terminal, offset } = allocation;
    assert.ok(clip.x >= 0 && clip.y >= 0 && clip.width > 0 && clip.height > 0);
    assert.ok(clip.x + clip.width <= viewport.width && clip.y + clip.height <= viewport.height);
    assert.equal(clip.x + offset.x, slot.x);
    assert.equal(clip.y + offset.y, slot.y);
    assert.deepEqual(terminal, slot);
  }
});
