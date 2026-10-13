import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { resolveShellExitConnectionId } from '../.tmp-agent-tests/src/lib/terminal/shellExit.js';

function runTest(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  fail ${name}`);
    throw error;
  }
}

runTest('resolveShellExitConnectionId finds hidden split panes even without cache id', () => {
  const terminals = {
    host: [
      { id: 'term-owner' },
      { id: 'term-extra' },
    ],
    other: [{ id: 'term-other' }],
  };
  assert.equal(resolveShellExitConnectionId('term-extra', 'host', terminals), 'host');
  assert.equal(resolveShellExitConnectionId('term-extra', undefined, terminals), 'host');
  assert.equal(resolveShellExitConnectionId('term-extra', 'missing', terminals), 'host');
  assert.equal(resolveShellExitConnectionId('term-missing', 'host', terminals), undefined);
});

// Exercise the actual event listener and service together. Keep desktop events
// and renderer cleanup at the boundary; do not replace the exit-routing logic.
function loadSource(file, dependencies) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../src/lib/terminal/${file}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const context = { exports: {}, console, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  } };
  runInNewContext(outputText, context);
  return context.exports;
}

for (const connectionId of ['local', 'ssh-host']) {
  runTest(`${connectionId}: a natural exit reaches the registered close handler for only that shell`, () => {
    const termId = 'shell-2';
    const terminalCache = new Map([[termId, {
      connectionId, generation: 3, spawned: true, starting: false,
      listenerAttached: false, suspendedByIdle: false, suspendedByPanel: false,
    }]]);
    const cache = { terminalCache, clearTerminalPendingInput: () => {} };
    const { terminalService } = loadSource('terminalService', {
      './instanceApi.js': {}, './suspendAllTerminals.js': {},
      './terminalCache.js': cache, './shellExit.js': { resolveShellExitConnectionId },
    });
    const closed = [];
    terminalService.setCloseTabHandler((owner, id) => closed.push([owner, id]));
    const callbacks = new Map();
    const { attachTerminalLifecycleListeners } = loadSource('terminalLifecycleListeners', {
      '@tauri-apps/api/event': { listen: (event, callback) => {
        callbacks.set(event, callback);
        return Promise.resolve(() => callbacks.delete(event));
      } },
      './inputQueue.js': { clearTerminalInputQueue: () => {} },
      './inputPipeline.js': { handleTerminalReady: () => {} },
      './terminalCache.js': cache,
      './terminalIdleSuspendNotice.js': { writeIdleHostSuspendNotice: () => {} },
      './terminalResizeSync.js': { clearTerminalResizeState: () => {} },
      './terminalService.js': { terminalService },
    });
    attachTerminalLifecycleListeners(termId, {});
    const exit = callbacks.get(`terminal-exit-${termId}`);
    assert.ok(exit);
    exit({ payload: { generation: 2, exit_code: 0 } });
    assert.equal(closed.length, 0, 'stale backend exit must not close a replacement shell');
    exit({ payload: { generation: 3, exit_code: 0 } });
    assert.deepEqual(closed, [[connectionId, termId]]);
    assert.equal(terminalCache.get(termId).spawned, false);
  });
}

console.log('Shell exit routing tests passed.');
