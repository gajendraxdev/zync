import assert from 'node:assert/strict';
import {
  longestCommonPrefix,
  resolveTabAction,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/behavior.js';
import {
  resolvePopupKeyAction,
  resolvePopupInteractionDecision,
  resolveGhostInputDispatchDecision,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/controller.js';
import {
  createClosedGhostPopupState,
  createOpenGhostPopupState,
  moveGhostPopupSelectionState,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/popupState.js';
import {
  createInitialGhostTabState,
  resetGhostTabState,
} from '../.tmp-agent-tests/src/lib/ghostSuggestions/tabState.js';
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

await runTest('longestCommonPrefix computes shared prefix across values', () => {
  assert.equal(longestCommonPrefix(['abc', 'abd', 'abx']), 'ab');
  assert.equal(longestCommonPrefix(['one']), 'one');
  assert.equal(longestCommonPrefix([]), '');
});

await runTest('resolveTabAction accepts single candidate immediately', () => {
  const prev = { lastLine: '', lastAt: 0 };
  const now = 1000;
  const out = resolveTabAction('git ch', ['eckout '], prev, now);
  assert.equal(out.kind, 'accept');
  assert.equal(out.suffix, 'eckout ');
  assert.deepEqual(out.nextState, { lastLine: 'git ch', lastAt: now });
});

await runTest('resolveTabAction uses shared prefix on first tab and list on second tab', () => {
  const first = resolveTabAction(
    'cd /va',
    ['r/', 'riable/', 'runtimes/'],
    { lastLine: '', lastAt: 0 },
    2000,
  );
  assert.equal(first.kind, 'accept');

  const second = resolveTabAction(
    'cd /va',
    ['r/', 'riable/', 'runtimes/'],
    { lastLine: 'cd /va', lastAt: 2100 },
    2500,
  );
  assert.equal(second.kind, 'show_list');
});

await runTest('popup state helpers open/close and move selection safely', () => {
  const closed = createClosedGhostPopupState();
  assert.equal(closed.visible, false);
  assert.equal(closed.items.length, 0);
  assert.equal(closed.anchorLine, '');

  const open = createOpenGhostPopupState(['a', 'b', 'c'], 'cd lo');
  assert.equal(open.visible, true);
  assert.equal(open.selectedIndex, 0);
  assert.equal(open.anchorLine, 'cd lo');

  const moved = moveGhostPopupSelectionState(open, 1);
  assert.equal(moved.selectedIndex, 1);

  const wrapped = moveGhostPopupSelectionState(open, -1);
  assert.equal(wrapped.selectedIndex, 2);
});

await runTest('resolvePopupKeyAction maps keys to actions', () => {
  const popup = createOpenGhostPopupState(['x']);
  assert.deepEqual(resolvePopupKeyAction('\t', popup), { kind: 'next' });
  assert.deepEqual(resolvePopupKeyAction('\x1b[A', popup), { kind: 'prev' });
  assert.deepEqual(resolvePopupKeyAction('\x1bOB', popup), { kind: 'next' });
  assert.deepEqual(resolvePopupKeyAction('\r', popup), { kind: 'accept' });
  assert.deepEqual(resolvePopupKeyAction('\x1b', popup), { kind: 'dismiss' });
  assert.deepEqual(resolvePopupKeyAction('\x03', popup), { kind: 'dismiss' });
});

await runTest('resolvePopupInteractionDecision exposes reducer-friendly decisions', () => {
  const popup = createOpenGhostPopupState(['x']);
  assert.deepEqual(resolvePopupInteractionDecision('\x1b[B', popup), { consumed: true, moveDelta: 1 });
  assert.deepEqual(resolvePopupInteractionDecision('\r', popup), { consumed: true, acceptSelection: true });
  assert.deepEqual(resolvePopupInteractionDecision('a', popup), { consumed: false, closeAndPass: true });
  assert.deepEqual(resolvePopupInteractionDecision('a', createClosedGhostPopupState()), { consumed: false });
});

await runTest('resolveGhostInputDispatchDecision centralizes popup/tab/tracker routing', () => {
  const open = createOpenGhostPopupState(['one', 'two']);
  assert.deepEqual(
    resolveGhostInputDispatchDecision('\x1b[B', open, true),
    { moveDelta: 1, shouldFeedTracker: false },
  );
  assert.deepEqual(
    resolveGhostInputDispatchDecision('\t', createClosedGhostPopupState(), true),
    { triggerTabPopup: true, shouldFeedTracker: false },
  );
  assert.deepEqual(
    resolveGhostInputDispatchDecision('x', open, true),
    { closePopupBeforeContinue: true, triggerTabPopup: false, shouldFeedTracker: true },
  );
});

await runTest('tab state helpers return stable defaults', () => {
  assert.deepEqual(createInitialGhostTabState(), { lastLine: '', lastAt: 0 });
  assert.deepEqual(resetGhostTabState(), { lastLine: '', lastAt: 0 });
});

await runTest('handleGhostInputEvent routes popup navigation and acceptance', async () => {
  const popup = createOpenGhostPopupState(['one', 'two']);
  let moved = 0;
  let accepted = 0;
  let dismissed = 0;
  let triggered = 0;

  const tracker = {
    feed: () => ({ consumed: false }),
  };

  const handledNext = await handleGhostInputEvent({
    data: '\x1b[B',
    popup,
    tracker,
    onMovePopupSelection: (delta) => { moved += delta; },
    onAcceptPopupSelection: () => { accepted += 1; },
    onDismissPopup: () => { dismissed += 1; },
    onTriggerTabPopup: async () => { triggered += 1; },
  });
  assert.equal(handledNext, true);
  assert.equal(moved, 1);

  const handledAccept = await handleGhostInputEvent({
    data: '\r',
    popup,
    tracker,
    onMovePopupSelection: () => {},
    onAcceptPopupSelection: () => { accepted += 1; },
    onDismissPopup: () => {},
    onTriggerTabPopup: async () => {},
  });
  assert.equal(handledAccept, true);
  assert.equal(accepted, 1);

  const handledDismiss = await handleGhostInputEvent({
    data: '\x03',
    popup,
    tracker,
    onMovePopupSelection: () => {},
    onAcceptPopupSelection: () => {},
    onDismissPopup: () => { dismissed += 1; },
    onTriggerTabPopup: async () => {},
  });
  assert.equal(handledDismiss, true);
  assert.equal(dismissed, 1);

  const handledTabTrigger = await handleGhostInputEvent({
    data: '\t',
    popup: createClosedGhostPopupState(),
    tracker,
    onMovePopupSelection: () => {},
    onAcceptPopupSelection: () => {},
    onDismissPopup: () => {},
    onTriggerTabPopup: async () => { triggered += 1; },
  });
  assert.equal(handledTabTrigger, true);
  assert.equal(triggered, 1);
});

await runTest('handleGhostInputEvent feeds tracker when not otherwise handled', async () => {
  let feedCalls = 0;
  const tracker = {
    feed: () => {
      feedCalls += 1;
      return { consumed: false };
    },
  };

  const handled = await handleGhostInputEvent({
    data: 'a',
    popup: createClosedGhostPopupState(),
    tracker,
    onMovePopupSelection: () => {},
    onAcceptPopupSelection: () => {},
    onDismissPopup: () => {},
    onTriggerTabPopup: async () => {},
  });

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
        // Simulate hanging remote fs_list call.
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
  tracker.feed('\x1b[D'); // left arrow -> desync
  tracker.feed('t');      // should be ignored for suggestion tracking

  assert.deepEqual(changed, ['g', 'gi']);
  assert.ok(dismissed.length >= 1);
  assert.equal(tracker.getLineBuffer(), '');

  tracker.feed('\x15'); // Ctrl+U resets desync guard
  tracker.feed('l');
  assert.deepEqual(changed, ['g', 'gi', 'l']);
});
