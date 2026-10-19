import { bindGhostTrackerRuntime } from '../src/lib/ghostSuggestions/runtime';
import { InputTracker } from '../src/lib/ghostSuggestions/inputTracker';
import { resolveWslShellIdForPathCompletion } from '../src/lib/ghostSuggestions/wslShell';
import { scheduleZshAutosuggestProbe } from '../src/lib/ghostSuggestions/zshAutosuggestDetect';
import {
  confirmTerminalGhostCwd,
  getTerminalGhostCwd,
  invalidateTerminalGhostCwd,
  terminalCache,
  type TerminalCache,
} from '../src/lib/terminal/terminalCache';

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) throw new Error(label);
}

const sessionId = 'ghost-cwd-safety';
const entry = {
  generation: 1, spawned: true, starting: false, connectionId: 'local',
  term: { rows: 24, cols: 80 }, pendingInput: '', pendingInputBytes: 0,
  inputFlushTimer: null, desiredResize: null, lastResize: null,
} as TerminalCache;
const previousWindow = typeof window === 'undefined' ? undefined : window;
const invoked: string[] = [];
globalThis.window = {
  ipcRenderer: { send() {}, invoke: async (command: string) => { invoked.push(command); } },
  setTimeout, clearTimeout,
} as unknown as Window & typeof globalThis;
const { handleTerminalReady, queueTerminalInput } = await import('../src/lib/terminal/inputPipeline');
const { useAppStore } = await import('../src/store/useAppStore');
const { spawnTerminalSession } = await import('../src/lib/terminal/ptyLifecycle');
const previousTerminals = useAppStore.getState().terminals;
useAppStore.setState({ terminals: { local: [{ id: sessionId, title: 'Shell', shellOverride: 'powershell', lastKnownCwd: '/persisted' }] } });
terminalCache.set(sessionId, entry);
try {
  equal(getTerminalGhostCwd(sessionId), undefined, 'saved or initial CWD is not current-shell evidence');
  equal(confirmTerminalGhostCwd(sessionId, '/actual', 1), true, 'fresh shell CWD is accepted');
  equal(getTerminalGhostCwd(sessionId), '/actual', 'observed CWD is available to completions');
  const firstRevision = entry.ghostCwdRevision;
  confirmTerminalGhostCwd(sessionId, '/actual', 1);
  equal(entry.ghostCwdRevision, firstRevision, 'an unchanged prompt does not invalidate useful requests');
  equal(confirmTerminalGhostCwd(sessionId, '/stale', 0), false, 'previous-generation reports are rejected');
  equal(getTerminalGhostCwd(sessionId), '/actual', 'stale output cannot replace live CWD');

  for (const command of ['cd missing', 'false && cd wrong', 'cd quoted\\ path | cat', 'pushd elsewhere']) {
    queueTerminalInput(sessionId, `${command}\r`);
    equal(getTerminalGhostCwd(sessionId), undefined, `${command}: no speculative destination is promoted`);
    confirmTerminalGhostCwd(sessionId, '/actual', 1);
    equal(getTerminalGhostCwd(sessionId), '/actual', `${command}: shell evidence restores the actual CWD`);
  }
  entry.generation++;
  equal(getTerminalGhostCwd(sessionId), undefined, 'respawn cannot reuse previous-generation CWD');
  confirmTerminalGhostCwd(sessionId, '/new-shell', 2);
  entry.spawned = false;
  equal(getTerminalGhostCwd(sessionId), undefined, 'a closed PTY has no authoritative CWD');
  equal(confirmTerminalGhostCwd(sessionId, '/closed', 2), false, 'closed PTY reports are rejected');
  entry.spawned = true;
  entry.starting = true;
  confirmTerminalGhostCwd(sessionId, '/prompt-before-ready', 2);
  equal(handleTerminalReady(sessionId, 2), true, 'ready acknowledges the active generation');
  equal(getTerminalGhostCwd(sessionId), '/prompt-before-ready', 'ready cannot overwrite an earlier live prompt');
  equal(invoked.length, 0, 'ready does not seed PTY CWD from separate WSL or SFTP processes');
  entry.starting = true;
  const commandEpoch = entry.ghostCommandEpoch;
  queueTerminalInput(sessionId, 'cd waiting-for-ready\r');
  equal(entry.ghostCommandEpoch, commandEpoch, 'queued input does not invalidate output from a shell that has not received it');
  confirmTerminalGhostCwd(sessionId, '/prompt-while-starting', 2);
  handleTerminalReady(sessionId, 2);
  equal(entry.ghostCommandEpoch, (commandEpoch ?? 0) + 1, 'actually sending Enter advances the command epoch');
  equal(getTerminalGhostCwd(sessionId), undefined, 'flushing input held before ready invalidates any intervening prompt CWD');
  invalidateTerminalGhostCwd(sessionId);
  equal(getTerminalGhostCwd(sessionId), undefined, 'saved tab CWD does not become live evidence after invalidation');

  for (const shell of ['powershell', 'cmd', 'default', undefined, '/bin/bash']) {
    equal(resolveWslShellIdForPathCompletion(shell, true), undefined, `${shell}: Unix-looking paths cannot select WSL`);
  }
  equal(resolveWslShellIdForPathCompletion('wsl', true), 'wsl', 'explicit Windows WSL spawn selects Linux filesystem');
  equal(resolveWslShellIdForPathCompletion('wsl:Ubuntu', true), 'wsl:Ubuntu', 'explicit distro identity is preserved');
  equal(resolveWslShellIdForPathCompletion('wsl:Ubuntu', false), undefined, 'Unix local and SSH tabs cannot select WSL');

  let dismissals = 0;
  const visibleTracker = new InputTracker({ onLineChange() {}, onAccept() {}, onDismiss() { dismissals++; }, onHistoryCommit() {} });
  entry.ghostTracker = visibleTracker;
  visibleTracker.feed('cat fi');
  dismissals = 0;
  visibleTracker.setSuggestion('le-in-old-directory');
  confirmTerminalGhostCwd(sessionId, '/fresh', 2);
  equal(visibleTracker.getSuggestion(), '', 'a changed CWD removes an already displayed suffix');
  equal(visibleTracker.getLineBuffer(), 'cat fi', 'CWD confirmation preserves current typed input');
  equal(visibleTracker.isDesynced(), false, 'CWD confirmation does not break line tracking');
  visibleTracker.setSuggestion('le');
  invalidateTerminalGhostCwd(sessionId);
  equal(visibleTracker.getSuggestion(), '', 'unknown CWD removes an already displayed suffix');
  equal(dismissals, 2, 'CWD changes dismiss the visible ghost through the existing runtime callback');
  entry.ghostTracker = undefined;

  // Unchanged typed input must not admit an asynchronous result from another CWD.
  let deliver!: (suffix: string) => void;
  let requested!: () => void;
  const requestStarted = new Promise<void>((resolve) => { requested = resolve; });
  const replies: string[] = [];
  const tracker = new InputTracker({ onLineChange() {}, onAccept() {}, onDismiss() {}, onHistoryCommit() {} });
  const unbind = bindGhostTrackerRuntime({
    tracker, debounceMs: 0,
    getContextVersion: () => `${entry.generation}:${entry.ghostCwdRevision}`,
    resolveInlineSuggestion: () => { requested(); return new Promise<string>((resolve) => { deliver = resolve; }); },
    onSuggestion: (suffix) => { if (suffix) replies.push(suffix); },
    onAccept() {}, onHistoryCommit() {}, onClearUI() {},
  });
  try {
    tracker.feed('cat fi');
    await requestStarted;
    confirmTerminalGhostCwd(sessionId, '/different', 2);
    deliver('le-from-old-directory');
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
    equal(replies.length, 0, 'delayed result from a different CWD is rejected');
    equal(tracker.feed('\x1b[C').consumed, false, 'old CWD suffix cannot be accepted');
  } finally {
    unbind();
  }

  // Delayed native-shell detection belongs to one cached entry and PTY generation.
  const probes: Array<(content: string) => void> = [];
  window.ipcRenderer.invoke = async (command: string) => {
    if (command !== 'read_wsl_zsh_init_files') return undefined;
    return new Promise<string>((resolve) => { probes.push(resolve); });
  };
  scheduleZshAutosuggestProbe(sessionId, 'local', 'wsl:Ubuntu');
  const oldProbe = entry.zshAutosuggestProbe!;
  entry.spawned = false;
  spawnTerminalSession({ termId: sessionId, connectionId: 'local', term: entry.term, shell: 'wsl:Ubuntu' });
  equal(entry.zshAutosuggestProbe, undefined, 'a fresh PTY clears the previous generation probe');
  scheduleZshAutosuggestProbe(sessionId, 'local', 'wsl:Ubuntu');
  const replacementProbe = entry.zshAutosuggestProbe!;
  probes[0]('source zsh-autosuggestions');
  await oldProbe;
  equal(entry.zshAutosuggestEnabled, undefined, 'old generation cannot apply native-shell suppression');
  equal(entry.zshAutosuggestProbe, replacementProbe, 'old generation cannot clear the replacement probe');
  probes[1]('plugins=(git)');
  await replacementProbe;
  equal(entry.zshAutosuggestEnabled, false, 'the current generation result is retained');
  equal(entry.zshAutosuggestProbe, undefined, 'the current generation clears its own completed probe');

  scheduleZshAutosuggestProbe(sessionId, 'local', 'wsl:Ubuntu');
  const clearedProbe = entry.zshAutosuggestProbe!;
  scheduleZshAutosuggestProbe(sessionId, 'local', 'powershell');
  probes[2]('source zsh-autosuggestions');
  await clearedProbe;
  equal(entry.zshAutosuggestEnabled, undefined, 'non-zsh clearing cannot be undone by an earlier probe');
} finally {
  terminalCache.delete(sessionId);
  useAppStore.setState({ terminals: previousTerminals });
  if (previousWindow) globalThis.window = previousWindow;
  else Reflect.deleteProperty(globalThis, 'window');
}
console.log('Ghost CWD provenance, WSL backend and stale-reply safety checks passed.');
