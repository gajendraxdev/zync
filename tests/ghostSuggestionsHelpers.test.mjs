import assert from 'node:assert/strict';
import {
  handleGhostInputEvent,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/runtime.js';
import {
  getPathSuggestions,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/pathCompletion.js';
import {
  InputTracker,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/inputTracker.js';

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${name}: ${message}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    } else {
      console.error(error);
    }
    throw error;
  }
}

await runTest('handleGhostInputEvent accepts inline ghost with right arrow', () => {
  let accepted = '';
  const tracker = new InputTracker({
    onLineChange: () => {},
    onAccept: (suffix) => { accepted = suffix; },
    onDismiss: () => {},
    onHistoryCommit: () => {},
  });

  tracker.feed('git ');
  tracker.setSuggestion('status');

  const handled = handleGhostInputEvent('\x1b[C', tracker);
  assert.equal(handled, true);
  assert.equal(accepted, 'status');
  assert.equal(tracker.getLineBuffer(), 'git status');
});

await runTest('handleGhostInputEvent passes Tab to shell when no active suggestion', () => {
  const tracker = new InputTracker({
    onLineChange: () => {},
    onAccept: () => {},
    onDismiss: () => {},
    onHistoryCommit: () => {},
  });

  tracker.feed('git ');
  const handled = handleGhostInputEvent('\t', tracker);
  assert.equal(handled, false);
});

await runTest('handleGhostInputEvent feeds tracker for printable input', () => {
  let feedCalls = 0;
  const tracker = {
    feed: () => {
      feedCalls += 1;
      return { consumed: false };
    },
  };

  const handled = handleGhostInputEvent('a', tracker);
  assert.equal(handled, false);
  assert.equal(feedCalls, 1);
});

await runTest('getPathSuggestions supports bare cd folder prefixes without slash', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    ipcRenderer: {
      invoke: async (_cmd, payload) => {
        assert.equal(payload.path, '/home/me');
        return [
          { name: 'Documents', type: 'directory' },
          { name: 'Downloads', type: 'directory' },
          { name: 'notes.txt', type: 'file' },
        ];
      },
    },
  };

  try {
    const out = await getPathSuggestions('cd Do', '/home/me', 'local-cd', 10);
    assert.deepEqual(out, ['cuments/', 'wnloads/']);
  } finally {
    globalThis.window = originalWindow;
  }
});

await runTest('getPathSuggestions keeps non-path commands quiet for bare words', async () => {
  const originalWindow = globalThis.window;
  let called = false;
  globalThis.window = {
    ipcRenderer: {
      invoke: async () => {
        called = true;
        return [];
      },
    },
  };

  try {
    const out = await getPathSuggestions('echo Do', '/home/me', 'local-echo', 10);
    assert.deepEqual(out, []);
    assert.equal(called, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

await runTest('getPathSuggestions supports bare file prefixes for cat', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    ipcRenderer: {
      invoke: async (_cmd, payload) => {
        assert.equal(payload.path, '/home/me');
        return [
          { name: 'README.md', type: 'file' },
          { name: 'README.txt', type: 'file' },
          { name: 'reports', type: 'directory' },
        ];
      },
    },
  };

  try {
    const out = await getPathSuggestions('cat REA', '/home/me', 'local-cat', 10);
    assert.deepEqual(out, ['DME.md', 'DME.txt']);
  } finally {
    globalThis.window = originalWindow;
  }
});

await runTest('getPathSuggestions does not use bare-word FS for non-core commands', async () => {
  const originalWindow = globalThis.window;
  let called = false;
  globalThis.window = {
    ipcRenderer: {
      invoke: async () => {
        called = true;
        return [];
      },
    },
  };

  try {
    const out = await getPathSuggestions('pwd Do', '/home/me', 'local-pwd', 10);
    assert.deepEqual(out, []);
    assert.equal(called, false);
  } finally {
    globalThis.window = originalWindow;
  }
});

await runTest('getPathSuggestions falls back to stale cache on slow fs_list', async () => {
  const originalWindow = globalThis.window;
  let callCount = 0;
  globalThis.window = {
    ipcRenderer: {
      invoke: async () => {
        callCount += 1;
        if (callCount === 1) {
          return [{ name: 'Documents', type: 'directory' }];
        }
        return new Promise(() => {});
      },
    },
  };

  try {
    const first = await getPathSuggestions('cd Do', '/home/me', 'local-cache', 10, 50);
    assert.deepEqual(first, ['cuments/']);

    const second = await getPathSuggestions('cd Do', '/home/me', 'local-cache', 10, 10);
    assert.deepEqual(second, ['cuments/']);
  } finally {
    globalThis.window = originalWindow;
  }
});

await runTest('InputTracker suppresses suggestions after unknown escape edits until reset', () => {
  const changed = [];
  const dismissed = [];
  const tracker = new InputTracker({
    onLineChange: (line) => changed.push(line),
    onAccept: () => {},
    onDismiss: () => dismissed.push(true),
    onHistoryCommit: () => {},
  });

  tracker.feed('g');
  tracker.feed('i');
  tracker.feed('\x1b[D');
  tracker.feed('t');

  assert.deepEqual(changed, ['g', 'gi']);
  assert.ok(dismissed.length >= 1);
  assert.equal(tracker.getLineBuffer(), '');

  tracker.feed('\x15');
  tracker.feed('l');
  assert.deepEqual(changed, ['g', 'gi', 'l']);
});