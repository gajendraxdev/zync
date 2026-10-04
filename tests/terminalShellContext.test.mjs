import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { canTrackTerminalShell, observeTerminalShellContext } from '../.tmp-agent-tests/src/lib/terminal/terminalShellContext.js';
import { InputTracker } from '../.tmp-agent-tests/src/lib/ghostSuggestions/inputTracker.js';
import { bindGhostTrackerRuntime } from '../.tmp-agent-tests/src/lib/ghostSuggestions/runtime.js';

function signal() {
  const listeners = new Set();
  return { event: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; }, fire: () => listeners.forEach(fn => fn()), listeners };
}
const buffer = signal();
const parsed = signal();
const csi = new Map();
const term = {
  buffer: { active: { type: 'normal' }, onBufferChange: buffer.event },
  modes: { mouseTrackingMode: 'none' }, onWriteParsed: parsed.event,
  parser: { registerCsiHandler: (id, fn) => { csi.set(id.final, fn); return { dispose: () => csi.delete(id.final) }; } },
};
let paused = false;
let generation = 0;
let invalidations = 0;
const observation = observeTerminalShellContext(term, {
  isPaused: () => paused, generation: () => generation, invalidate: () => invalidations++,
});
assert.equal(canTrackTerminalShell(term), true);
generation = 1; observation.sync();
assert.equal(invalidations, 0, 'initial spawn does not disable normal first-line suggestions');
term.buffer.active.type = 'alternate'; buffer.fire();
assert.equal(canTrackTerminalShell(term), false);
assert.equal(invalidations, 1);
term.buffer.active.type = 'normal'; buffer.fire();
assert.equal(invalidations, 2, 'return invalidates old shell context');
term.modes.mouseTrackingMode = 'drag'; parsed.fire();
assert.equal(canTrackTerminalShell(term), false);
assert.equal(invalidations, 3);
term.modes.mouseTrackingMode = 'none'; parsed.fire();
assert.equal(invalidations, 4);
assert.equal(csi.get('h')([1000]), false, 'observer does not consume terminal escape sequence');
assert.equal(csi.get('l')([1000]), false);
assert.equal(invalidations, 6, 'mode round trip in one output frame invalidates');
assert.equal(csi.get('h')([2004]), false);
assert.equal(invalidations, 6, 'bracketed paste alone does not suspend shell');
paused = true; observation.sync();
assert.equal(canTrackTerminalShell(term, paused), false);
paused = false; observation.sync();
generation++; observation.sync();
assert.equal(invalidations, 9);
observation.dispose();
assert.equal(buffer.listeners.size + parsed.listeners.size + csi.size, 0, 'all observers disposed');

// Exercise the production OSC 7 callback without mounting the React/PTY lifecycle.
const lifecycleSource = ts.createSourceFile('useTerminalLifecycle.ts', await readFile(new URL('../src/components/terminal/useTerminalLifecycle.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const oscHandlers = [];
function collectOscHandlers(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && node.expression.name.text === 'registerOscHandler' && node.arguments[0]?.getText(lifecycleSource) === '7') {
    oscHandlers.push(node.arguments[1].getText(lifecycleSource));
  }
  ts.forEachChild(node, collectOscHandlers);
}
collectOscHandlers(lifecycleSource);
assert.equal(oscHandlers.length, 1, 'exercise exactly the production OSC 7 handler');
const cwdUpdates = [];
const sessionId = 'cwd-session';
const terminalKey = 'local';
const terminalCache = new Map();
const useAppStore = { getState: () => ({ setTerminalCwd: (...args) => cwdUpdates.push(args) }) };
const onOsc7 = new Function('terminalCache', 'sessionId', 'term', 'canTrackTerminalShell', 'useAppStore', 'terminalKey', `return (${oscHandlers[0]});`)(terminalCache, sessionId, term, canTrackTerminalShell, useAppStore, terminalKey);
for (const owner of [{}, { ghostContextActive: false }, { ghostContextActive: true, ghostPaused: true }]) {
  terminalCache.set(sessionId, owner);
  assert.equal(onOsc7('file://host/home/test%20user'), true);
  assert.deepEqual(cwdUpdates.at(-1), [terminalKey, sessionId, '/home/test user']);
}
assert.equal(cwdUpdates.length, 3, 'explicit CWD works before observer binding and while suggestions are paused');
onOsc7('file://host/C:/Users/test');
assert.equal(cwdUpdates.at(-1)[2], 'C:/Users/test', 'Windows path normalization is preserved');
const acceptedUpdates = cwdUpdates.length;
term.buffer.active.type = 'alternate'; onOsc7('file://host/untrusted');
term.buffer.active.type = 'normal'; term.modes.mouseTrackingMode = 'drag'; onOsc7('file://host/untrusted');
term.modes.mouseTrackingMode = 'none'; onOsc7('file://host/%broken');
terminalCache.delete(sessionId); onOsc7('file://host/stale');
assert.equal(cwdUpdates.length, acceptedUpdates, 'unsafe context, malformed reports and missing owners cannot update CWD');

const commits = [];
const tracker = new InputTracker({ onLineChange: () => {}, onAccept: () => {}, onDismiss: () => {}, onHistoryCommit: text => commits.push(text) });
tracker.feed('unfinished'); tracker.setSuggestion('suffix'); tracker.suspend();
assert.equal(tracker.getLineBuffer(), '');
assert.equal(tracker.isDesynced(), true);
assert.equal(tracker.feed('\x1b[C').consumed, false, 'old suffix cannot accept navigation');
tracker.feed('\r');
assert.deepEqual(commits, [], 'resync does not commit old input');
tracker.feed('echo safe'); tracker.feed('\r');
assert.deepEqual(commits, ['echo safe']);
tracker.enterSecretInputMode(); tracker.suspend();
assert.equal(tracker.isSecretInputMode(), true, 'context suspension cannot clear a secret prompt');

// A delayed provider result is rejected even if the text is unchanged, and even
// if the terminal has returned to a safe state before that result arrives.
for (const change of ['epoch', 'disabled', 'suspended', 'unmounted']) {
  let enabled = true;
  let epoch = 0;
  let deliver;
  let entered;
  const requested = new Promise(done => { entered = done; });
  const replies = [];
  const input = new InputTracker({ onLineChange: () => {}, onAccept: () => {}, onDismiss: () => {}, onHistoryCommit: () => {} });
  const unbind = bindGhostTrackerRuntime({
    tracker: input, debounceMs: 0, isEnabled: () => enabled, getContextVersion: () => epoch,
    resolveInlineSuggestion: () => { entered(); return new Promise(done => { deliver = done; }); },
    onSuggestion: suffix => { if (suffix) replies.push(suffix); }, onAccept: () => {}, onHistoryCommit: () => {}, onClearUI: () => {},
  });
  input.feed('git');
  await requested;
  if (change === 'epoch') epoch++;
  if (change === 'disabled') enabled = false;
  if (change === 'suspended') input.suspend();
  if (change === 'unmounted') unbind();
  deliver(' status');
  await new Promise(done => setImmediate(done));
  assert.deepEqual(replies, [], change);
  assert.equal(input.feed('\x1b[C').consumed, false, change);
  unbind();
}
// A rejected provider must not block the next suggestion or escape as an
// unhandled rejection. Wait on callbacks rather than arbitrary timing sleeps.
{
  let rejectFirst;
  let requested;
  let resolved;
  const firstRequest = new Promise(done => { requested = done; });
  const secondSuggestion = new Promise(done => { resolved = done; });
  const input = new InputTracker({ onLineChange: () => {}, onAccept: () => {}, onDismiss: () => {}, onHistoryCommit: () => {} });
  let calls = 0;
  const dispose = bindGhostTrackerRuntime({
    tracker: input, debounceMs: 0,
    resolveInlineSuggestion: () => {
      if (++calls === 1) { requested(); return new Promise((_, reject) => { rejectFirst = reject; }); }
      return Promise.resolve(' status');
    },
    onSuggestion: suffix => { if (suffix) resolved(suffix); }, onAccept: () => {}, onHistoryCommit: () => {}, onClearUI: () => {},
  });
  input.feed('gi');
  await firstRequest;
  rejectFirst(new Error('temporary provider failure'));
  await new Promise(done => setImmediate(done));
  input.feed('t');
  assert.equal(await secondSuggestion, ' status');
  assert.equal(calls, 2);
  dispose();
}
console.log('Terminal mode, paused history, secret-input, stale-suggestion and provider recovery tests passed.');
