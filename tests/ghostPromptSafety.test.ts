import { InputTracker } from '../src/lib/ghostSuggestions/inputTracker';
import {
  clearPromptCwdSniffer, extractCwdFromPromptOutput, feedPromptCwdSniffer,
} from '../src/lib/ghostSuggestions/promptCwdSniffer';
import {
  clearSecretInputSniffer, feedTerminalPromptSniffers,
} from '../src/lib/ghostSuggestions/secretInputDetect';
import {
  getTerminalGhostCwd, invalidateTerminalGhostCwd, terminalCache, type TerminalCache,
} from '../src/lib/terminal/terminalCache';

function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(label);
}

const encoder = new TextEncoder();
let checks = 0;
function check(label: string, body: () => void): void {
  body();
  checks++;
  console.log(`PASS ${label}`);
}

function fixture() {
  const id = `prompt-safety-${checks}`;
  const changes: string[] = [];
  const commits: string[] = [];
  const paths: string[] = [];
  const tracker = new InputTracker({
    onLineChange: line => changes.push(line), onHistoryCommit: line => commits.push(line),
    onAccept: () => {}, onDismiss: () => {},
  });
  return {
    tracker, changes, commits, paths,
    output: (text: string) => feedTerminalPromptSniffers(id, encoder.encode(text), tracker, path => paths.push(path)),
    dispose: () => { clearPromptCwdSniffer(id); clearSecretInputSniffer(id); tracker.destroy(); },
  };
}

for (const prompt of ['PS C:\\Work> ', 'C:\\Work> ', 'user@host:~/work$ ', 'host:~ # ']) {
  check(`old ${prompt.trim()} cannot clear a subsequent password guard`, () => {
    const f = fixture();
    try {
      f.output(prompt);
      f.output('Password: ');
      equal(f.tracker.isSecretInputMode(), true, 'old prompt must not unlock hidden input');
      f.tracker.feed('AUDIT_DUMMY_INPUT');
      f.tracker.feed('\r');
      f.tracker.feed('SECOND_DUMMY_INPUT');
      f.tracker.feed('\r');
      equal(f.changes, [], 'no hidden input reaches a provider');
      equal(f.commits, [], 'no hidden input reaches history');
      equal(f.tracker.isSecretInputMode(), true, 'submission is not a shell prompt');
      f.output(`\r\n${prompt}`);
      equal(f.tracker.isSecretInputMode(), false, 'fresh shell prompt restores tracking');
      f.tracker.feed('echo safe');
      f.tracker.feed('\r');
      equal(f.commits, ['echo safe'], 'normal history resumes after prompt');
    } finally { f.dispose(); }
  });
}

check('prompt and password arriving in one frame remain guarded', () => {
  const f = fixture();
  try {
    f.output('PS C:\\Work> sudo command\r\n[sudo] password for test: ');
    equal(f.tracker.isSecretInputMode(), true, 'only the current line can restore shell context');
    equal(f.paths, [], 'an older line is not current CWD evidence');
  } finally { f.dispose(); }
});

check('password fragments cannot reuse a consumed prompt', () => {
  const f = fixture();
  try {
    f.output('PS C:\\Work> ');
    f.output('Pass');
    f.output('word: ');
    equal(f.tracker.isSecretInputMode(), true, 'split password prompt is detected');
    f.output('\x1b[?25h');
    equal(f.tracker.isSecretInputMode(), true, 'cursor updates cannot unlock input');
  } finally { f.dispose(); }
});

check('ordinary command echo does not reset the tracked line', () => {
  const f = fixture();
  try {
    f.output('PS C:\\Work> ');
    f.tracker.feed('cd C:');
    f.output('C:');
    equal(f.tracker.getLineBuffer(), 'cd C:', 'consumed prompt cannot reset typing');
    equal(f.paths, ['C:\\Work'], 'old prompt only reports once');
    f.tracker.exitSecretInputMode();
    equal(f.tracker.getLineBuffer(), 'cd C:', 'non-secret exit is a no-op');
  } finally { f.dispose(); }
});

check('split path fragments are not skipped when punctuation is absent', () => {
  const f = fixture();
  try {
    f.output('PS C:'); f.output('\\Pro'); f.output('jects'); f.output('> ');
    equal(f.paths, ['C:\\Projects'], 'all bounded fragments contribute to prompt');
  } finally { f.dispose(); }
});

check('latest prompt wins over earlier recognized output', () => {
  equal(extractCwdFromPromptOutput('PS C:\\Old> \r\nuser@host:/new# '), '/new', 'never prefer an old PowerShell prompt');
  equal(extractCwdFromPromptOutput('PS C:\\Work> typed command'), null, 'echoed commands are not waiting prompts');
  equal(extractCwdFromPromptOutput('PS C:\\Work>\r\nprogress'), null, 'output after a prompt is not a prompt');
});

check('CMD drive roots, spaces and UNC prompts retain exact paths', () => {
  for (const path of ['C:\\', 'C:\\Program Files', '\\\\server\\share\\folder']) {
    equal(extractCwdFromPromptOutput(`${path}> `), path, 'default CMD prompt is supported');
  }
});

check('colour escapes and split UTF-8 prompt paths stay valid', () => {
  const id = 'prompt-safety-utf8';
  const paths: string[] = [];
  const data = encoder.encode('\x1b[32mPS C:\\café>\x1b[0m ');
  const boundary = data.indexOf(0xc3) + 1;
  try {
    feedPromptCwdSniffer(id, data.subarray(0, boundary), path => paths.push(path));
    feedPromptCwdSniffer(id, data.subarray(boundary), path => paths.push(path));
    equal(paths, ['C:\\café'], 'decoder preserves split multibyte characters');
  } finally { clearPromptCwdSniffer(id); }
});

check('truncated output cannot complete an unrelated earlier prompt', () => {
  const id = 'prompt-safety-truncated';
  const paths: string[] = [];
  try {
    feedPromptCwdSniffer(id, encoder.encode('PS C:\\'), path => paths.push(path));
    feedPromptCwdSniffer(id, encoder.encode('Work> '), path => paths.push(path), { resetBuffer: true, resetDecoder: true });
    equal(paths, [], 'skipped bytes invalidate partial prompt state');
  } finally { clearPromptCwdSniffer(id); }
});

check('password editing, Tab and late suggestions never consume or infer input', () => {
  const f = fixture();
  try {
    f.tracker.enterSecretInputMode();
    for (const data of ['DUMMY', '\x7f', '\x15', '\t', '\r']) {
      f.tracker.setSuggestion('must not appear');
      equal(f.tracker.feed(data).consumed, false, 'native shell owns hidden input');
      equal(f.tracker.getLineBuffer(), '', 'hidden input is not buffered');
      equal(f.tracker.getSuggestion(), '', 'delayed suggestion cannot become visible');
    }
    equal(f.changes, [], 'no provider changes');
    equal(f.commits, [], 'no history commits');
    f.tracker.suspend();
    equal(f.tracker.isSecretInputMode(), true, 'context change retains guard');
    f.tracker.feed('\x03');
    equal(f.tracker.isSecretInputMode(), false, 'explicit Ctrl+C cancels authentication');
  } finally { f.dispose(); }
});

// Exercise the production output-channel callback as well as the pure detectors.
// The parser is independently covered in terminalShellContext; this controllable
// xterm stub lets queued output finish after reconnect or command submission.
{
  const previousWindow = typeof window === 'undefined' ? undefined : window;
  globalThis.window = {
    ipcRenderer: { invoke: async () => undefined, send() {} },
    __TAURI_INTERNALS__: { transformCallback: () => 1, unregisterCallback() {} },
  } as unknown as Window & typeof globalThis;
  const { useAppStore } = await import('../src/store/useAppStore');
  const { attachTerminalOutputChannel } = await import('../src/lib/terminal/terminalOutputStream');
  const previousSetCwd = useAppStore.getState().setTerminalCwd;
  const storedPaths: string[] = [];
  useAppStore.setState({ setTerminalCwd: (_connection, _id, path) => { storedPaths.push(path); } });
  const writes: (() => void)[] = [];
  const id = 'prompt-output-provenance';
  const term = {
    buffer: { active: { type: 'normal' } }, modes: { mouseTrackingMode: 'none' },
    write: (_data: Uint8Array, done: () => void) => { writes.push(done); },
  } as unknown as TerminalCache['term'];
  const f = fixture();
  const entry = {
    term, generation: 1, spawned: true, connectionId: 'local', ghostTracker: f.tracker,
    ghostContextActive: true, ghostContextEpoch: 0, ghostCommandEpoch: 0,
  } as TerminalCache;
  terminalCache.set(id, entry);
  try {
    const channel = attachTerminalOutputChannel(id, term);
    const receive = (generation: number, text: string) => {
      const bytes = encoder.encode(text);
      const frame = new Uint8Array(4 + bytes.length);
      new DataView(frame.buffer).setUint32(0, generation, true);
      frame.set(bytes, 4);
      channel.onmessage(frame.buffer);
    };
    const parsed = (osc7Path?: string) => {
      entry.pendingOsc7Cwd = osc7Path;
      const done = writes.shift();
      if (!done) throw new Error('expected one pending production write');
      done();
    };
    receive(1, 'PS C:\\Work> '); parsed();
    equal(getTerminalGhostCwd(id), 'C:\\Work', 'production prompt confirms CWD');
    receive(1, 'Password: ');
    entry.ghostCommandEpoch = 1;
    invalidateTerminalGhostCwd(id);
    parsed();
    equal(f.tracker.isSecretInputMode(), true, 'queued password detection survives a newer command send');
    f.tracker.feed('DUMMY_ONLY'); f.tracker.feed('\r');
    equal(f.commits, [], 'production detector ordering keeps password out of history');
    receive(1, 'PS C:\\Work> ');
    entry.generation = 2;
    invalidateTerminalGhostCwd(id);
    parsed('/old-osc7');
    equal(getTerminalGhostCwd(id), undefined, 'queued old generation cannot promote OSC 7');
    equal(entry.pendingOsc7Cwd, undefined, 'rejected OSC 7 cannot be reused by a later frame');
    equal(f.tracker.isSecretInputMode(), true, 'queued old prompt cannot unlock hidden input');

    receive(2, 'PS C:\\Old> ');
    entry.ghostCommandEpoch = 2;
    invalidateTerminalGhostCwd(id);
    parsed('/before-new-command');
    equal(getTerminalGhostCwd(id), undefined, 'queued prompt cannot undo a later command submission');
    equal(f.tracker.isSecretInputMode(), true, 'pre-command prompt cannot unlock input');

    receive(2, '\r\nPS C:\\Current> '); parsed();
    equal(getTerminalGhostCwd(id), 'C:\\Current', 'fresh current output restores CWD');
    equal(f.tracker.isSecretInputMode(), false, 'fresh current output restores normal input');

    receive(2, '\r\nPassword: '); parsed();
    receive(2, '\x1b]7;file://host/before-submit\x07'); parsed('/before-submit');
    equal(f.tracker.isSecretInputMode(), true, 'OSC 7 before password submission cannot unlock input');
    f.tracker.feed('DUMMY_ONLY'); f.tracker.feed('\r');
    entry.ghostCommandEpoch = (entry.ghostCommandEpoch ?? 0) + 1;
    invalidateTerminalGhostCwd(id);
    receive(2, '\r\n❯ \x1b]7;file://host/custom\x07'); parsed('/custom');
    equal(f.tracker.isSecretInputMode(), false, 'confirmed OSC 7 restores a custom prompt after submission');
    f.tracker.feed('echo recovered'); f.tracker.feed('\r');
    equal(f.commits, ['echo recovered'], 'ordinary history resumes without recording the password');

    receive(2, '\r\nPassword: '); parsed();
    f.tracker.feed('DUMMY_RETRY'); f.tracker.feed('\r');
    entry.ghostCommandEpoch = (entry.ghostCommandEpoch ?? 0) + 1;
    invalidateTerminalGhostCwd(id);
    receive(2, '\r\nPassword: \x1b]7;file://host/retry-cwd\x07'); parsed('/retry-cwd');
    equal(f.tracker.isSecretInputMode(), true, 'another password prompt wins over OSC 7 in the same frame');
    f.tracker.feed('SECOND_DUMMY'); f.tracker.feed('\r');
    entry.ghostCommandEpoch = (entry.ghostCommandEpoch ?? 0) + 1;
    invalidateTerminalGhostCwd(id);
    receive(2, '\r\n❯ \x1b]7;file://host/after-retry\x07'); parsed('/after-retry');
    equal(f.tracker.isSecretInputMode(), false, 'a later submitted retry can recover on a fresh custom prompt');
    equal(f.commits, ['echo recovered'], 'both retry values stay out of history');

    receive(2, '\r\nPassword: '); parsed();
    receive(2, '\x1b]7;file://host/pre-submit-output\x07');
    f.tracker.feed('DUMMY_AGAIN'); f.tracker.feed('\r');
    entry.ghostCommandEpoch = (entry.ghostCommandEpoch ?? 0) + 1;
    invalidateTerminalGhostCwd(id);
    parsed('/pre-submit-output');
    equal(f.tracker.isSecretInputMode(), true, 'OSC 7 queued before submission cannot recover afterwards');
    receive(2, '\x1b]7;file://host/old-context\x07');
    entry.ghostContextEpoch = 1;
    parsed('/old-context');
    equal(f.tracker.isSecretInputMode(), true, 'a changed shell context cannot recover hidden input');

    entry.ghostPaused = true;
    entry.ghostContextActive = false;
    receive(2, '\x1b]7;file://host/explicit\x07'); parsed('/explicit');
    equal(getTerminalGhostCwd(id), '/explicit', 'explicit OSC 7 remains available while ghosts are paused/unbound');
    equal(f.tracker.isSecretInputMode(), true, 'uninspected paused/unbound output cannot recover hidden input');
    equal(storedPaths, ['C:\\Work', 'C:\\Current', '/before-submit', '/custom', '/retry-cwd', '/after-retry', '/explicit'], 'only current reports reach stored CWD');
    checks++;
    console.log('PASS production output provenance, password ordering and paused OSC 7');
  } finally {
    terminalCache.delete(id);
    f.dispose();
    useAppStore.setState({ setTerminalCwd: previousSetCwd });
    if (previousWindow) globalThis.window = previousWindow;
    else Reflect.deleteProperty(globalThis, 'window');
  }
}

console.log(`Ghost prompt/password safety checks passed (${checks}).`);
