import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { declaredIconId, findIconTheme, iconThemeOptions, iconThemeRevision } from '../.tmp-agent-tests/src/lib/icons/iconTheme.js';
import { ensureThemedIcon, getThemedIconEntry, subscribeThemedIcon, reportThemedIconLoadError, fileTypeIconID, themedIconKey } from '../.tmp-agent-tests/src/lib/icons/themedIconSrc.js';
import { resolveIconResource } from '../.tmp-agent-tests/src/lib/icons/icon-map.js';
import { loadSource } from './helpers/loadSource.mjs';

const catalog = JSON.parse(await readFile(new URL('../plugin-api/builtin-icon-themes.json', import.meta.url), 'utf8'));
const builtins = catalog.map(plugin => ({ ...plugin, enabled: true }));
const authored = JSON.parse(await readFile(new URL('./fixtures/plugins/icon-theme/manifest.json', import.meta.url), 'utf8'));
const pack = { path: '/plugins/dev.example.icons', manifest: authored, enabled: true };

test('one registry supplies built-in and community choices, with no duplicate or disabled choices', () => {
  assert.deepEqual(iconThemeOptions([...builtins, pack]).map(choice => choice.id), [...catalog.map(plugin => plugin.manifest.id), pack.manifest.id]);
  assert.equal(iconThemeOptions([...builtins, pack, pack]).length, 4);
  assert.equal(iconThemeOptions([...builtins, { ...pack, enabled: false }]).length, 3);
  assert.equal(findIconTheme([], pack.manifest.id), undefined);
  assert.equal(findIconTheme([{ ...pack, enabled: false }], pack.manifest.id), undefined);
  const spoofed = { ...pack, manifest: { ...pack.manifest, id: builtins[2].manifest.id } };
  assert.equal(findIconTheme([spoofed, builtins[2]], spoofed.manifest.id), builtins[2]);
  assert.equal(findIconTheme([spoofed, { ...builtins[2], enabled: false }], spoofed.manifest.id), undefined);
});

test('authored mappings override defaults without edits to Zync, and compound extensions use longest match', () => {
  const definition = structuredClone(authored.iconTheme);
  definition.fileExtensions.gz = 'source';
  for (const [name, folder, expected] of [['package.json', false, 'source'], ['app.TS', false, 'source'], ['backup.tar.gz', false, 'file'],
    ['SRC', true, 'source'], ['constructor', false, 'file'], ['__proto__', true, 'folder'], ['src ', true, 'folder']]) {
    assert.equal(declaredIconId(name, folder, definition), expected);
    assert.equal(fileTypeIconID(name, folder, pack.manifest.id, definition), expected);
  }
  assert.equal(new Set(Array.from({ length: 1000 }, (_, index) => declaredIconId(`unknown-${index}`, false, definition))).size, 1);
});

test('resource identity changes on version updates, reloads and local same-version edits', () => {
  assert.equal(iconThemeRevision(pack), iconThemeRevision(pack));
  const updated = { ...pack, manifest: { ...pack.manifest, version: '1.0.1' } };
  const localEdit = { ...pack, manifest: structuredClone(pack.manifest) };
  assert.notEqual(iconThemeRevision(pack), iconThemeRevision(updated));
  assert.notEqual(iconThemeRevision(pack), iconThemeRevision(localEdit));
  assert.notEqual(themedIconKey(pack.manifest.id, 'file', '', pack.path, '', iconThemeRevision(pack)),
    themedIconKey(pack.manifest.id, 'file', '', pack.path, '', iconThemeRevision(localEdit)));
});

test('community resources stay inside the package and cannot borrow built-in artwork', () => {
  globalThis.window = { __TAURI_INTERNALS__: { convertFileSrc: value => `asset://${value}` } };
  assert.equal(resolveIconResource('source', pack.manifest.id, pack.path, undefined, authored.iconTheme).local,
    'asset:///plugins/dev.example.icons/icons/source.svg');
  assert.deepEqual(resolveIconResource('missing', pack.manifest.id, pack.path, undefined, authored.iconTheme), {});
  const unsafe = structuredClone(authored.iconTheme);
  unsafe.iconDefinitions.file.iconPath = '../outside.svg';
  assert.deepEqual(resolveIconResource('file', pack.manifest.id, pack.path, undefined, unsafe), {});
  assert.deepEqual(resolveIconResource('file', pack.manifest.id, 'builtin://not-registered', undefined, authored.iconTheme), {});
});

test('same-version reloads change native image URLs and image errors fall back once', async () => {
  globalThis.window = { __TAURI_INTERNALS__: { convertFileSrc: value => `asset://${value}` } };
  const urls = [];
  for (const provider of [pack, { ...pack }]) {
    const revision = iconThemeRevision(provider);
    const key = themedIconKey(pack.manifest.id, 'file', '', pack.path, '', revision);
    ensureThemedIcon(key, 'file', pack.manifest.id, pack.path, undefined, authored.iconTheme, revision);
    await new Promise(resolve => setImmediate(resolve));
    const entry = getThemedIconEntry(key);
    assert.equal(entry.status, 'ready');
    urls.push(entry.src);
    reportThemedIconLoadError(key, 'file', pack.manifest.id, pack.path, undefined, authored.iconTheme, revision);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(getThemedIconEntry(key).status, 'missing');
  }
  assert.notEqual(urls[0], urls[1]);
});

test('idle generations are bounded while subscribed artwork and recently used entries remain cached', async () => {
  const keys = [];
  const liveKey = themedIconKey('bounded', 'file', '', pack.path, '', 'live');
  const releaseLive = subscribeThemedIcon(liveKey, () => {});
  ensureThemedIcon(liveKey, 'file', 'bounded', pack.path, undefined, authored.iconTheme, 'live');
  try {
    for (let generation = 0; generation < 540; generation++) {
      const revision = `bounded-${generation}`;
      const key = themedIconKey('bounded', 'file', '', pack.path, '', revision);
      keys.push(key);
      const release = subscribeThemedIcon(key, () => {});
      ensureThemedIcon(key, 'file', 'bounded', pack.path, undefined, authored.iconTheme, revision);
      await new Promise(resolve => setImmediate(resolve));
      release();
    }
    assert.equal(getThemedIconEntry(keys[0]), undefined);
    assert.ok(keys.filter(key => getThemedIconEntry(key)).length <= 512);
    assert.equal(getThemedIconEntry(keys.at(-1)).status, 'ready');
    assert.equal(getThemedIconEntry(liveKey).status, 'ready');
  } finally { releaseLive(); }
});

test('released async loads cannot repopulate the cache or remove a replacement request', async () => {
  const pending = [];
  const engine = loadSource('lib/icons/themedIconSrc.ts', {
    './icon-map': { CATEGORY_FALLBACK_MAP: {}, resolveIconResource: () => ({ remote: 'https://test.invalid/icon.svg' }) },
    './iconCache': { getCachedIcon: () => new Promise(resolve => pending.push(resolve)) },
    './iconTheme': {},
  });
  const key = 'async-generation';
  const release = engine.subscribeThemedIcon(key, () => {});
  engine.ensureThemedIcon(key, 'file', 'theme');
  release();
  assert.equal(engine.getThemedIconEntry(key), undefined);
  const releaseNew = engine.subscribeThemedIcon(key, () => {});
  engine.ensureThemedIcon(key, 'file', 'theme');
  pending[0]('old.svg');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.getThemedIconEntry(key).status, 'loading');
  engine.ensureThemedIcon(key, 'file', 'theme');
  assert.equal(pending.length, 2, 'old cleanup preserves deduplication of the replacement');
  pending[1]('new.svg');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.getThemedIconEntry(key).src, 'new.svg');
  releaseNew();

  const abandoned = engine.subscribeThemedIcon('abandoned', () => {});
  engine.ensureThemedIcon('abandoned', 'file', 'theme');
  abandoned();
  pending[2]('abandoned.svg');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(engine.getThemedIconEntry('abandoned'), undefined);
});
