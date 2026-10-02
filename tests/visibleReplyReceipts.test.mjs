import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('receipts require visible reply footers and foreground focus, deduplicate and clean up', async () => {
  let setup, observe, cleanup, refreshed = 0, disconnected = false;
  const calls = [];
  const listeners = new Map();
  const doc = { visibilityState: 'visible', hasFocus: () => false,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const win = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const compiled = ts.transpileModule(readFileSync(new URL('../src/features/feedbackInbox/useVisibleReplyReceipts.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, document: doc, window: win,
    require: (name) => name === 'react' ? { useRef: (value) => ({ current: value }), useEffect: (fn) => { setup = fn; } }
      : { acknowledgeReply: async (id) => { calls.push(id); } },
    IntersectionObserver: class { constructor(fn) { observe = fn; } observe() {} disconnect() { disconnected = true; } },
  });
  exports.useVisibleReplyReceipts({ current: { querySelectorAll: () => [] } }, [], () => refreshed++, assert.fail);
  cleanup = setup();
  const entry = (id, visible) => ({ target: { dataset: { unreadReply: id } }, isIntersecting: visible, intersectionRatio: visible ? 1 : 0 });
  observe([entry('seen', true), entry('below-scroll', false)]);
  assert.deepEqual(calls, []);
  doc.hasFocus = () => true;
  doc.visibilityState = 'hidden';
  listeners.get('focus')();
  assert.deepEqual(calls, []);
  doc.visibilityState = 'visible';
  listeners.get('visibilitychange')();
  listeners.get('focus')();
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['seen']);
  assert.equal(refreshed, 1);
  cleanup();
  assert.equal(disconnected, true);
  assert.equal(listeners.size, 0);
  observe([entry('late', true)]);
  assert.deepEqual(calls, ['seen']);
});
