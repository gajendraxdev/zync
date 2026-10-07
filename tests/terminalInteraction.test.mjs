import assert from 'node:assert/strict';
import {
  registerTerminalInteraction, terminalInteractionForEvent, pasteIntoTerminal, runTerminalInteraction, openTerminalFind,
} from '../.tmp-agent-tests/src/lib/terminal/terminalInteraction.js';

class Events extends EventTarget {
  listeners = new Set();
  addEventListener(type, fn, opts) { this.listeners.add(fn); super.addEventListener(type, fn, opts); }
  removeEventListener(type, fn, opts) { this.listeners.delete(fn); super.removeEventListener(type, fn, opts); }
}
class ElementStub { closest() { return this.root ?? this; } }
globalThis.Element = ElementStub;

function fixture() {
  const window = new Events();
  const document = Object.assign(new Events(), { defaultView: window, hasFocus: () => true, hidden: false });
  const root = Object.assign(new ElementStub(), { ownerDocument: document, isConnected: true });
  const input = Object.assign(new ElementStub(), { root });
  root.contains = node => node === input || node === root;
  document.activeElement = input;
  const state = { ready: true, generation: 1, pasted: [] };
  const target = {
    root, isAvailable: () => state.ready, epoch: () => state.generation,
    selection: () => '', paste: text => state.pasted.push(text), focus: () => { document.activeElement = input; },
  };
  const dispose = registerTerminalInteraction(target);
  const event = { target: input, composedPath: () => [input, root] };
  return { window, document, root, input, state, target, dispose, event };
}

const one = fixture();
const two = fixture();
assert.equal(terminalInteractionForEvent(one.event), one.target);
assert.equal(terminalInteractionForEvent(two.event), two.target);
assert.equal(runTerminalInteraction('find', two.event), false, 'unsupported plugin search passes through');
await pasteIntoTerminal(one.target, async () => 'hello\nworld');
assert.deepEqual(one.state.pasted, ['hello\nworld'], 'no appended Enter');
assert.deepEqual(two.state.pasted, [], 'other terminal receives nothing');
one.dispose(); two.dispose();

const search = fixture();
let searches = 0;
search.target.find = () => { searches++; };
search.document.activeElement = {}; // Clicking toolbar moves focus away from xterm.
assert.equal(openTerminalFind(search.root), true);
assert.equal(searches, 1);
search.state.ready = false;
assert.equal(openTerminalFind(search.root), false, 'hidden/unavailable terminals cannot be searched');
search.state.ready = true;
search.root.isConnected = false;
assert.equal(openTerminalFind(search.root), false, 'detached terminals cannot be searched');
search.root.isConnected = true;
search.dispose();
assert.equal(openTerminalFind(search.root), false, 'disposed registration cannot receive Find');
assert.equal(openTerminalFind(null), false);
assert.equal(searches, 1);

for (const [name, invalidate] of [
  ['reconnect', f => { f.state.generation++; }],
  ['hidden', f => { f.state.ready = false; }],
  ['unregistered', f => f.dispose()],
  ['detached DOM', f => { f.root.isConnected = false; }],
  ['window blur', f => f.window.dispatchEvent(new Event('blur'))],
  ['focus away then back', f => {
    f.document.activeElement = {};
    f.document.dispatchEvent(new Event('focusin'));
    f.document.activeElement = f.input;
    f.document.dispatchEvent(new Event('focusin'));
  }],
  ['document hidden', f => { f.document.hidden = true; }],
  ['document hidden then visible', f => {
    f.document.hidden = true;
    f.document.dispatchEvent(new Event('visibilitychange'));
    f.document.hidden = false;
    f.document.dispatchEvent(new Event('visibilitychange'));
  }],
]) {
  const f = fixture();
  let resolve;
  const pending = pasteIntoTerminal(f.target, () => new Promise(done => { resolve = done; }));
  invalidate(f);
  resolve('sensitive text');
  await pending;
  assert.deepEqual(f.state.pasted, [], name);
  assert.equal(f.window.listeners.size + f.document.listeners.size, 0, 'pending observers cleaned');
  f.dispose();
}

const failure = fixture();
await assert.rejects(pasteIntoTerminal(failure.target, async () => { throw new Error('clipboard unavailable'); }));
assert.equal(failure.window.listeners.size + failure.document.listeners.size, 0);
await pasteIntoTerminal(failure.target, async () => 'recovered');
assert.deepEqual(failure.state.pasted, ['recovered']);
const replacement = { ...failure.target };
const removeReplacement = registerTerminalInteraction(replacement);
failure.dispose();
assert.equal(terminalInteractionForEvent(failure.event), replacement, 'old cleanup cannot remove new registration');
removeReplacement();
console.log('Focused-terminal clipboard targeting, lifecycle races and cleanup tests passed.');
