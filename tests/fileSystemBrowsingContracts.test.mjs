/** Characterization of the real Files slice. Only the native/notification boundaries are substituted. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const requests = [];
const unexpectedCommands = [];
globalThis.window = { ipcRenderer: { invoke(command, args) {
  if (!['fs_list', 'fs_cwd'].includes(command)) unexpectedCommands.push(command);
  assert.ok(['fs_list', 'fs_cwd'].includes(command), `Unexpected operation: ${command}`);
  return new Promise((resolve, reject) => requests.push({ command, args, resolve, reject }));
} } };
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/store/fileSystemSlice.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm',
  plugins: [{ name: 'notification-boundary', setup(builder) {
    builder.onResolve({ filter: /features[\\/]notifications$/ }, () => ({ path: 'notifications', namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const notify = () => {};', loader: 'js' }));
  } }],
});
const { createFileSystemSlice, filesStoreKey, splitFileName } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
let serial = 0;
let checks = 0;
function harness() {
  const connectionId = `fixture-${++serial}`;
  const settings = Object.freeze({ iconTheme: 'user-plugin', fileView: 'grid', keybindings: { custom: 'Alt+Q' } });
  let state = { connections: [{ id: connectionId, homePath: '/home/deploy' }], settings, disconnect: () => assert.fail('Browsing must not silently disconnect this fixture') };
  const set = update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
  const get = () => state;
  Object.assign(state, createFileSystemSlice(set, get, {}));
  return { connectionId, get, settings };
}
const sample = name => ({ name, path: `/sample/${name}`, type: '-', size: 4, lastModified: 1, permissions: '644', owner: 'deploy', group: 'team' });
function request(command = 'fs_list') {
  const call = requests.shift();
  assert.ok(call, 'Expected a native read request');
  assert.equal(call.command, command);
  return call;
}
function checked(fixture, label) {
  assert.equal(fixture.get().settings, fixture.settings, 'Browsing must preserve saved settings identity');
  assert.equal(requests.length, 0, 'No unexpected native calls');
  assert.deepEqual(unexpectedCommands, [], 'The real slice must issue reads only in these browsing tests');
  checks++;
  console.log(`  ok ${label}`);
}

assert.notEqual(filesStoreKey('host', 'a'), filesStoreKey('host', 'b'));
assert.notEqual(filesStoreKey('host-a', 'pane'), filesStoreKey('host-b', 'pane'));
assert.deepEqual(splitFileName('.env'), { base: '.env', ext: '' });
assert.deepEqual(splitFileName('notes.v2.md'), { base: 'notes.v2', ext: '.md' });

{
  const f = harness();
  const oldLoad = f.get().loadFiles(f.connectionId, '/old', false, false, 'one');
  const old = request();
  const latestLoad = f.get().loadFiles(f.connectionId, '/new', false, false, 'one');
  const latest = request();
  latest.resolve([sample('new')]); await latestLoad;
  old.resolve([sample('old')]); await oldLoad;
  const key = filesStoreKey(f.connectionId, 'one');
  assert.equal(f.get().currentPath[key], '/new');
  assert.equal(f.get().files[key][0].name, 'new');
  assert.deepEqual(f.get().recentPaths[f.connectionId], ['/new']);
  checked(f, 'latest listing wins even when the older request succeeds later');
}
{
  const f = harness();
  const older = f.get().loadFiles(f.connectionId, '/old', false, false, 'one'); const old = request();
  const newer = f.get().loadFiles(f.connectionId, '/new', false, false, 'one'); const next = request();
  next.resolve([sample('new')]); await newer;
  old.reject(new Error('DISCONNECTED: late reply')); await older;
  assert.equal(f.get().error[filesStoreKey(f.connectionId, 'one')], null);
  checked(f, 'a stale error cannot replace the newer listing or connection state');
}
{
  const f = harness();
  const a = f.get().loadFiles(f.connectionId, '/a', false, false, 'left'); const left = request();
  const b = f.get().loadFiles(f.connectionId, '/b', false, false, 'right'); const right = request();
  right.resolve([sample('right')]); await b; left.resolve([sample('left')]); await a;
  assert.equal(f.get().files[filesStoreKey(f.connectionId, 'left')][0].name, 'left');
  assert.equal(f.get().currentPath[filesStoreKey(f.connectionId, 'right')], '/b');
  checked(f, 'two Files panes on the same host keep independent listings and paths');
}
{
  const f = harness();
  const pending = f.get().loadFiles(f.connectionId, '/before-clear'); const call = request();
  f.get().clearRecentPaths(f.connectionId); call.resolve([sample('x')]); await pending;
  assert.deepEqual(f.get().recentPaths[f.connectionId], []);
  checked(f, 'clearing recent paths is not undone by an in-flight listing');
}
{
  const f = harness();
  f.get().connections[0].homePath = '';
  const homeLoad = f.get().loadFiles(f.connectionId, '~', false, false, 'pane'); const home = request('fs_cwd');
  const explicitLoad = f.get().loadFiles(f.connectionId, '/explicit', false, false, 'pane'); const explicit = request();
  explicit.resolve([sample('explicit')]); await explicitLoad;
  home.resolve('/home/deploy'); await homeLoad;
  assert.equal(f.get().currentPath[filesStoreKey(f.connectionId, 'pane')], '/explicit');
  checked(f, 'a stale home lookup cannot trigger another listing or replace explicit navigation');
}
{
  const f = harness();
  const load = f.get().loadFiles(f.connectionId, '/source', false, false, 'source'); request().resolve([sample('item')]); await load;
  f.get().copyFilesListing(f.connectionId, 'source', 'split');
  const source = filesStoreKey(f.connectionId, 'source'); const split = filesStoreKey(f.connectionId, 'split');
  assert.notEqual(f.get().history[source], f.get().history[split], 'History arrays must not be shared');
  const move = f.get().loadFiles(f.connectionId, '/other', false, false, 'split'); request().resolve([]); await move;
  assert.equal(f.get().currentPath[source], '/source');
  assert.deepEqual(f.get().history[source], ['/source']);
  checked(f, 'duplicating a Files pane copies browsing state without linking histories');
}
{
  const f = harness();
  const load = f.get().loadFiles(f.connectionId, '/folder', false, false, 'one'); request().resolve([sample('before')]); await load;
  const key = filesStoreKey(f.connectionId, 'one'); const history = [...f.get().history[key]];
  const refreshed = f.get().refreshFiles(f.connectionId, 'one');
  const call = request(); assert.equal(call.args.path, '/folder'); call.resolve([sample('after')]); await refreshed;
  assert.deepEqual(f.get().history[key], history);
  assert.equal(f.get().files[key][0].name, 'after');
  checked(f, 'refresh targets the requested instance and does not add a history entry');
}
{
  const f = harness();
  const load = f.get().loadFiles(f.connectionId, '/unknown-owner');
  request().resolve([{ ...sample('item'), owner: undefined, group: null }]); await load;
  assert.equal(f.get().files[f.connectionId][0].owner, '');
  assert.equal(f.get().files[f.connectionId][0].group, '');
  checked(f, 'unknown account metadata remains unknown rather than guessed');
}
{
  const f = harness();
  const literalPath = '/home/deploy/release candidate  ';
  const load = f.get().loadFiles(f.connectionId, literalPath);
  const call = request(); assert.equal(call.args.path, literalPath); call.resolve([]); await load;
  assert.equal(f.get().currentPath[f.connectionId], literalPath);
  assert.deepEqual(f.get().history[f.connectionId], [literalPath]);
  assert.deepEqual(f.get().recentPaths[f.connectionId], [literalPath]);
  const refreshed = f.get().refreshFiles(f.connectionId);
  const refresh = request(); assert.equal(refresh.args.path, literalPath); refresh.resolve([]); await refreshed;
  checked(f, 'literal folder-name spaces survive listing, history, recents and refresh');
}
console.log(`Files browsing contracts: ${checks} behavioral checks passed.`);
