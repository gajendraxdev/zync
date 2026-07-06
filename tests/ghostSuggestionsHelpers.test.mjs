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
import {
  extractCwdFromPromptOutput,
  extractPowerShellCwd,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/promptCwdSniffer.js';
import {
  resolveCdTargetPath,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/cwdTracking.js';

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

await runTest('extractPowerShellCwd reads PS path prompts with angle bracket', () => {
  const cwd = extractPowerShellCwd('Directory: E:\\work\r\nPS E:\\work\u203A cd ');
  assert.equal(cwd, 'E:\\work');
});

await runTest('extractPowerShellCwd reads classic PS greater-than prompt', () => {
  const cwd = extractPowerShellCwd('PS C:\\Users\\me\\projects> ');
  assert.equal(cwd, 'C:\\Users\\me\\projects');
});

await runTest('extractCwdFromPromptOutput prefers PowerShell match in mixed output', () => {
  const cwd = extractCwdFromPromptOutput('\x1b[32mPS E:\\work\u203A\x1b[0m ');
  assert.equal(cwd, 'E:\\work');
});

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
  assert.equal(tracker.isDesynced(), true);
});

await runTest('handleGhostInputEvent passes Tab to shell and dismisses ghost when suffix is active', () => {
  let accepted = '';
  let dismissed = 0;
  const tracker = new InputTracker({
    onLineChange: () => {},
    onAccept: (suffix) => { accepted = suffix; },
    onDismiss: () => { dismissed += 1; },
    onHistoryCommit: () => {},
  });

  for (const ch of 'git ') tracker.feed(ch);
  tracker.setSuggestion('status');

  const handled = handleGhostInputEvent('\t', tracker);
  assert.equal(handled, false);
  assert.equal(accepted, '');
  assert.equal(dismissed, 1);
  assert.equal(tracker.isDesynced(), true);
  assert.equal(tracker.getLineBuffer(), 'git ');
});

await runTest('InputTracker suppresses ghost fetches while desynced after Tab', () => {
  const changed = [];
  const tracker = new InputTracker({
    onLineChange: (line) => changed.push(line),
    onAccept: () => {},
    onDismiss: () => {},
    onHistoryCommit: () => {},
  });

  for (const ch of 'git ') tracker.feed(ch);
  tracker.feed('\t');
  tracker.feed('s');

  assert.equal(tracker.isDesynced(), true);
  assert.deepEqual(changed, ['g', 'gi', 'git', 'git ']);
});

await runTest('InputTracker skips history commit while desynced then resets on Enter', () => {
  let committed = null;
  const tracker = new InputTracker({
    onLineChange: () => {},
    onAccept: () => {},
    onDismiss: () => {},
    onHistoryCommit: (cmd) => { committed = cmd; },
  });

  for (const ch of 'git ') tracker.feed(ch);
  tracker.feed('\t');
  assert.equal(tracker.isDesynced(), true);

  tracker.feed('\r');
  assert.equal(committed, null);
  assert.equal(tracker.isDesynced(), false);
  assert.equal(tracker.getLineBuffer(), '');
});

await runTest('InputTracker resumes ghost tracking after Ctrl+C clears desync', () => {
  const changed = [];
  const tracker = new InputTracker({
    onLineChange: (line) => changed.push(line),
    onAccept: () => {},
    onDismiss: () => {},
    onHistoryCommit: () => {},
  });

  for (const ch of 'git ') tracker.feed(ch);
  tracker.feed('\t');
  tracker.feed('\x03');
  tracker.feed('l');

  assert.equal(tracker.isDesynced(), false);
  assert.deepEqual(changed, ['g', 'gi', 'git', 'git ', 'l']);
});

await runTest('resolveCdTargetPath resolves relative multi-segment cd targets', () => {
  assert.equal(resolveCdTargetPath('cd foo/bar', 'E:\\work'), 'E:\\work\\foo\\bar');
  assert.equal(resolveCdTargetPath('cd ./src/lib', '/home/me'), '/home/me/src/lib');
});

await runTest('resolveCdTargetPath parentDirectory handles tilde cwd', () => {
  assert.equal(resolveCdTargetPath('cd ..', '~/foo/bar'), '~/foo');
  assert.equal(resolveCdTargetPath('cd ..', '~/only'), '~');
  assert.equal(resolveCdTargetPath('cd ..', '~'), null);
});

await runTest('getPathSuggestions maps home prefix for file-aware commands', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    ipcRenderer: {
      invoke: async (_cmd, payload) => {
        assert.equal(payload.path, '');
        return [
          { name: 'notes.txt', type: 'file' },
          { name: 'Documents', type: 'directory' },
        ];
      },
    },
  };

  try {
    const out = await getPathSuggestions('cat ~/no', '/home/me', 'local', 10);
    assert.deepEqual(out, ['tes.txt']);
  } finally {
    globalThis.window = originalWindow;
  }
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

await runTest('getPathSuggestions lists cwd entries for bare cd command token', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    ipcRenderer: {
      invoke: async (_cmd, payload) => {
        assert.equal(payload.connectionId, 'local');
        assert.equal(payload.path, '/home/me');
        return [
          { name: 'Documents', type: 'directory' },
          { name: 'Downloads', type: 'directory' },
        ];
      },
    },
  };

  try {
    const out = await getPathSuggestions('cd', '/home/me', 'local', 10);
    assert.deepEqual(out, ['Documents/', 'Downloads/']);
  } finally {
    globalThis.window = originalWindow;
  }
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