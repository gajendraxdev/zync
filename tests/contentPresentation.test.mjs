import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as paneLayout from '../.tmp-agent-tests/src/lib/paneLayout/index.js';
import * as presentation from '../.tmp-agent-tests/src/features/workspace/domain/presentation.js';
import * as regions from '../.tmp-agent-tests/src/lib/paneLayout/regions.js';

function loadSource(path, dependencies = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const context = { exports: {}, require: name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
    return dependencies[name];
  } };
  runInNewContext(outputText, context);
  return context.exports;
}

const metadata = loadSource('src/features/workspace/domain/contentPresentation.ts', { './presentation': presentation });
const identity = loadSource('src/lib/paneLayout/contentIdentity.ts');
const inventory = loadSource('src/features/workspace/domain/contentInventory.ts', {
  '../../../lib/paneLayout/contentIdentity': identity,
  '../../../lib/paneLayout/query': paneLayout,
});
const registrations = loadSource('src/features/workspace/domain/registrations.ts', {
  '../../../lib/paneLayout/types': loadSource('src/lib/paneLayout/types.ts'),
  '../../../lib/paneLayout/regions': regions,
});
const { createWorkspacePresentationSlice } = loadSource('src/store/workspacePresentationSlice.ts', {
  '../lib/paneLayout': paneLayout,
  '../lib/paneLayout/contentIdentity': identity,
  '../features/workspace/domain/presentation': presentation,
  '../features/workspace/domain/contentInventory': inventory,
  '../features/workspace/domain/contentPresentation': metadata,
  '../features/workspace/domain/registrations': registrations,
});
const key = identity.paneContentKey({ kind: 'term', termId: 'shell' }, 'shell');

test('drag reorders a live strip atomically while retaining dormant ranks and resource identities', () => {
  const subject = store();
  const keys = ['a', 'b', 'c'].map(id => identity.paneContentKey({ kind: 'term', termId: id }, id));
  const terminals = { local: ['a', 'b', 'c'].map(id => ({ id, title: id })) };
  const dormant = identity.paneContentKey({ kind: 'term', termId: 'absent' }, 'absent');
  subject.set({ terminals, contentPresentation: { local: { version: 3, items: { [keys[1]]: { displayAlias: 'Kept' } }, order: [keys[0], dormant, keys[1], keys[2]] } } });
  const groups = subject.get().paneLayouts;
  assert.equal(subject.get().reorderContent('local', [keys[2]], [keys[0]], false), true);
  assert.deepEqual(Array.from(subject.get().contentPresentation.local.order), [keys[2], dormant, keys[0], keys[1]]);
  assert.equal(subject.saves(), 1);
  assert.equal(subject.get().terminals, terminals); assert.equal(subject.get().paneLayouts, groups);
  assert.equal(subject.get().contentPresentation.local.items[keys[1]].displayAlias, 'Kept');
  assert.equal(subject.get().reorderContent('local', [keys[2]], [keys[0]], false), true);
  assert.equal(subject.saves(), 1, 'No-op drops do not persist again');
  for (const [source, target] of [[[], [keys[0]]], [[keys[0]], [keys[0]]], [[dormant], [keys[0]]]]) {
    assert.equal(subject.get().reorderContent('local', source, target, false), false);
  }
  subject.get().setContentPinned('local', keys[0], true);
  assert.equal(subject.get().reorderContent('local', [keys[2]], [keys[0]], false), false, 'Pin buckets remain distinct');
  subject.get().setContentHidden('local', keys[1], true);
  assert.equal(subject.get().reorderContent('local', [keys[1]], [keys[2]], false), false);
});

test('split drag moves complete groups and rejects stale membership', () => {
  const subject = store();
  const keys = ['a', 'b', 'c'].map(id => identity.paneContentKey({ kind: 'term', termId: id }, id));
  // Use the production constructor so the test tracks the canonical tree schema.
  const group = paneLayout.splitPane(paneLayout.singlePane('a', 'pane-a'), 'pane-a', 'horizontal', { kind: 'term', termId: 'b' });
  assert.ok(group?.layout);
  subject.set({ terminals: { local: ['a', 'b', 'c'].map(id => ({ id, title: id })) }, paneLayouts: { local: { a: group.layout } } });
  assert.equal(subject.get().reorderContent('local', [keys[0]], [keys[2]], true), false);
  assert.equal(subject.get().reorderContent('local', [keys[0], keys[1]], [keys[2]], true), true);
  assert.deepEqual(Array.from(subject.get().contentPresentation.local.order), [keys[2], keys[0], keys[1]]);
});

function store() {
  let saves = 0;
  let state = { terminals: { local: [{ id: 'shell', title: 'Original', tabVisible: false }] }, paneLayouts: {},
    sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false, saveSession: async () => { saves++; } };
  const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  state = { ...state, ...createWorkspacePresentationSlice(set, () => state) };
  return { get: () => state, set, saves: () => saves };
}

test('all persistent presentation edits refuse before session readiness or during restore/protection', () => {
  for (const patch of [{ sessionLoaded: false }, { isRestoring: true }, { sessionPersistenceBlocked: true }]) {
    const subject = store();
    subject.set({ ...patch, contentPresentation: { local: { version: 3,
      items: { [key]: { displayAlias: 'Kept', hidden: true, pinned: true } }, order: [key] } } });
    const before = subject.get();
    assert.equal(before.setContentDisplayAlias('local', key, 'Changed'), false);
    assert.equal(before.setContentPinned('local', key, false), false);
    assert.equal(before.setContentHidden('local', key, false), false);
    assert.equal(before.revealAllContent('local'), false);
    assert.equal(before.moveContent('local', key, 1), false);
    assert.equal(before.reorderContent('local', [key], ['missing'], false), false);
    before.resetContentOrder('local');
    before.forgetContentPresentation('local', [key]);
    before.resetContentPresentation('local');
    assert.equal(subject.get(), before);
    assert.equal(subject.saves(), 0);
  }
});

test('presentation parser normalizes alias text but never creates or prunes runtime instances', () => {
  const parsed = metadata.parseContentPresentation({ local: { version: 1, items: { [key]: { displayAlias: '  My  shell ' } } } });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.local.version, 3, 'Legacy aliases upgrade without changing their content identity');
  assert.equal(parsed.value.local.items[key].displayAlias, 'My shell');
  for (const raw of [undefined, null, {}]) assert.equal(metadata.parseContentPresentation(raw).ok, true);
  assert.equal(Object.keys(metadata.parseContentPresentation({ local: { version: 1, items: { [key]: { displayAlias: ' ' } } } }).value).length, 0);
});

test('unknown presentation versions/fields and oversized records fail closed', () => {
  const invalid = [
    [], { local: { version: 4, items: {} } }, { local: { version: 1, items: {}, order: [] } },
    { local: { version: 1, items: { [key]: { displayAlias: 'Alias', pinned: true } } } },
    { local: { version: 1, items: { [key]: { displayAlias: 12 } } } },
    { local: { version: 1, items: Object.fromEntries(Array.from({ length: metadata.MAX_PRESENTATION_ITEMS_PER_SCOPE + 1 }, (_, i) => [`["term","${i}"]`, { displayAlias: 'A' }])) } },
    Object.fromEntries(Array.from({ length: metadata.MAX_PRESENTATION_SCOPES + 1 }, (_, i) => [`scope-${i}`, { version: 1, items: {} }])),
  ];
  for (const raw of invalid) assert.equal(metadata.parseContentPresentation(raw).ok, false);
  for (const invalidKey of ['shell', '__proto__', '["future","shell"]', '[ "term", "shell" ]', '["term",""]']) {
    assert.equal(metadata.isContentPresentationKey(invalidKey), false);
  }
});

test('v2 validates pins and unique bounded order while retaining dormant identities', () => {
  const dormant = '["plugin","owner:panel","dormant"]';
  const parsed = metadata.parseContentPresentation({ local: { version: 2, items: {
    [key]: { displayAlias: 'Shell', pinned: false }, [dormant]: { pinned: true },
  }, order: [dormant, key] } });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.local.items[key].pinned, undefined);
  assert.equal(parsed.value.local.items[dormant].pinned, true);
  assert.deepEqual(Array.from(parsed.value.local.order), [dormant, key]);
  for (const scope of [
    { version: 2, items: { [key]: { pinned: null } } },
    { version: 2, items: { [key]: { pinned: 'true' } } },
    { version: 2, items: { [key]: { hidden: true } } },
    { version: 2, items: {}, order: null },
    { version: 2, items: {}, order: [key, key] },
    { version: 2, items: {}, order: ['not-a-key'] },
    { version: 2, items: { [key]: { pinned: true } }, order: Array.from({ length: 256 }, (_, i) => `["term","${i}"]`) },
  ]) assert.equal(metadata.parseContentPresentation({ local: scope }).ok, false);
  const orderOnly = metadata.parseContentPresentation({ local: { version: 2, items: {}, order: [dormant] } });
  assert.equal(orderOnly.ok, true);
  assert.deepEqual(Array.from(orderOnly.value.local.order), [dormant]);
});

test('visual sorting keeps original objects and canonical input untouched', () => {
  const keys = ['a', 'b', 'c', 'd'].map(id => `["term","${id}"]`);
  const items = Object.freeze(keys.map(id => Object.freeze({ id })));
  const scope = { version: 2, items: { [keys[2]]: { pinned: true }, [keys[3]]: { pinned: true } }, order: [keys[1], keys[3], '["term","absent"]'] };
  const sorted = metadata.sortContentPresentation(items, scope);
  assert.deepEqual(Array.from(sorted, item => item.id), [keys[3], keys[2], keys[1], keys[0]]);
  assert.equal(sorted[0], items[3]);
  assert.deepEqual(items.map(item => item.id), keys);
  assert.deepEqual(Array.from(metadata.sortContentPresentation(items, undefined)), Array.from(items));
});

test('alias changes preserve terminal identity, split membership and resource-owned titles', () => {
  const subject = store();
  const terminals = subject.get().terminals;
  assert.equal(subject.get().setContentDisplayAlias('local', key, ' Build '), true);
  assert.equal(subject.get().contentPresentation.local.items[key].displayAlias, 'Build');
  assert.equal(subject.get().terminals, terminals);
  assert.equal(subject.get().terminals.local[0].title, 'Original');
  assert.equal(subject.get().terminals.local[0].tabVisible, false);
  assert.equal(subject.saves(), 1);
  assert.equal(subject.get().setContentDisplayAlias('local', key, 'Build'), true);
  assert.equal(subject.saves(), 1);
  assert.equal(subject.get().setContentDisplayAlias('missing', key, 'No'), false);
  assert.equal(subject.get().setContentDisplayAlias('local', '["term","missing"]', 'No'), false);
  assert.equal(subject.get().setContentDisplayAlias('local', key, 'x'.repeat(81)), false);
  assert.equal(subject.get().setContentDisplayAlias('local', key, undefined), true);
  assert.equal(subject.get().contentPresentation.local, undefined);
});

test('grouped plugin aliases use instance identity and survive owner changes without remount metadata', () => {
  const subject = store();
  const group = paneLayout.singlePluginPane('fixture-plugin', 'pane', 'instance');
  const pluginKey = identity.paneContentKey(group.root.content, group.root.id);
  subject.set({ paneLayouts: { local: { originalOwner: group } } });
  assert.equal(subject.get().setContentDisplayAlias('local', pluginKey, 'Plugin alias'), true);
  subject.set({ paneLayouts: { local: { promotedOwner: group } } });
  assert.equal(subject.get().contentPresentation.local.items[pluginKey].displayAlias, 'Plugin alias');
  assert.equal(subject.get().setContentDisplayAlias('local', pluginKey, 'Renamed alias'), true);
  assert.equal(subject.get().paneLayouts.local.promotedOwner, group);
});

test('explicit close cleanup and reset affect only presentation and honor read-only sessions', () => {
  const subject = store();
  subject.get().setContentDisplayAlias('local', key, 'A');
  const terminals = subject.get().terminals;
  subject.get().forgetContentPresentation('local', ['not-present']);
  assert.equal(subject.saves(), 1);
  subject.set({ sessionPersistenceBlocked: true });
  subject.get().resetContentPresentation('local');
  subject.get().forgetContentPresentation('local', [key]);
  assert.equal(subject.get().setContentDisplayAlias('local', key, 'B'), false);
  assert.equal(subject.get().contentPresentation.local.items[key].displayAlias, 'A');
  subject.set({ sessionPersistenceBlocked: false });
  subject.get().forgetContentPresentation('local', [key]);
  assert.equal(subject.get().contentPresentation.local, undefined);
  subject.get().setContentDisplayAlias('local', key, 'A');
  subject.get().resetContentPresentation('local');
  assert.equal(subject.get().contentPresentation.local, undefined);
  assert.equal(subject.get().terminals, terminals);
});

test('registration replacement is transient and does not save or create content', () => {
  const subject = store();
  const terminals = subject.get().terminals;
  const registry = registrations.buildWorkspaceViewRegistry([]);
  subject.get().setWorkspaceViewRegistry(registry);
  assert.equal(subject.get().workspaceViewRegistry, registry);
  assert.equal(subject.get().terminals, terminals);
  assert.equal(subject.saves(), 0);
});

test('presentation limits reject additions but still allow edits and removals', () => {
  const subject = store();
  const items = Object.fromEntries(Array.from({ length: metadata.MAX_PRESENTATION_ITEMS_PER_SCOPE }, (_, i) => [
    `["term","saved-${i}"]`, { displayAlias: 'Existing' },
  ]));
  subject.set({ contentPresentation: { local: { version: 1, items } } });
  assert.equal(subject.get().setContentDisplayAlias('local', key, 'New'), false);
  assert.equal(subject.saves(), 0);
  subject.get().forgetContentPresentation('local', ['["term","saved-0"]']);
  assert.equal(subject.get().setContentDisplayAlias('local', key, 'New'), true);
  assert.equal(subject.get().setContentDisplayAlias('local', key, 'Edited'), true);
  assert.equal(subject.get().contentPresentation.local.items[key].displayAlias, 'Edited');
  assert.equal(subject.get().setContentDisplayAlias('local', key, undefined), true);

  subject.set({ contentPresentation: Object.fromEntries(Array.from({ length: metadata.MAX_PRESENTATION_SCOPES }, (_, i) => [
    `scope-${i}`, { version: 1, items: { [key]: { displayAlias: 'Existing' } } },
  ])) });
  assert.equal(subject.get().setContentDisplayAlias('local', key, 'New scope'), false);
  subject.get().resetContentPresentation('scope-0');
  assert.equal(subject.get().setContentDisplayAlias('local', key, 'New scope'), true);
});

test('opaque scope names are own metadata keys and never mutate object prototypes', () => {
  const subject = store();
  subject.set({ terminals: { ['__proto__']: [{ id: 'shell', title: 'Shell' }] } });
  assert.equal(subject.get().setContentDisplayAlias('__proto__', key, 'Prototype name'), true);
  assert.equal(Object.hasOwn(subject.get().contentPresentation, '__proto__'), true);
  assert.equal(subject.get().contentPresentation.__proto__.items[key].displayAlias, 'Prototype name');
  assert.equal(Object.hasOwn(subject.get().contentPresentation, 'items'), false);
  const parsed = metadata.parseContentPresentation(subject.get().contentPresentation);
  assert.equal(parsed.ok, true);
  assert.equal(Object.hasOwn(parsed.value, '__proto__'), true);
  subject.get().resetContentPresentation('__proto__');
  assert.equal(Object.hasOwn(subject.get().contentPresentation, '__proto__'), false);
});

test('pins and alias resets preserve independent decoration and never change auto-open settings', () => {
  const subject = store();
  const settings = { localTerm: { pinnedFeatures: ['files'] } };
  subject.set({ settings });
  const terminals = subject.get().terminals;
  subject.get().setContentDisplayAlias('local', key, 'Alias');
  assert.equal(subject.get().setContentPinned('local', key, true), true);
  const saves = subject.saves();
  assert.equal(subject.get().setContentPinned('local', key, true), true);
  assert.equal(subject.saves(), saves);
  subject.get().setContentDisplayAlias('local', key, undefined);
  assert.equal(subject.get().contentPresentation.local.items[key].pinned, true);
  subject.get().setContentDisplayAlias('local', key, 'Again');
  subject.get().setContentPinned('local', key, false);
  assert.equal(subject.get().contentPresentation.local.items[key].displayAlias, 'Again');
  assert.equal(subject.get().contentPresentation.local.items[key].pinned, undefined);
  assert.equal(subject.get().terminals, terminals);
  assert.equal(subject.get().settings, settings);
  assert.equal(subject.get().setContentPinned('local', '["term","missing"]', true), false);
  assert.equal(subject.get().setContentPinned('local', key, 'true'), false);
});

test('moves stay within pin buckets, retain absent IDs and do not reorder live resources', () => {
  const subject = store();
  const b = '["term","b"]';
  const c = '["term","c"]';
  const absent = '["plugin","owner:panel","absent"]';
  const terminals = { local: [{ id: 'shell', title: 'Shell' }, { id: 'b', title: 'B' }, { id: 'c', title: 'C' }] };
  subject.set({ terminals, contentPresentation: { local: { version: 2, items: { [c]: { pinned: true } }, order: [key, absent, b, c] } } });
  assert.equal(subject.get().moveContent('local', c, 1), false, 'Cannot cross the pin bucket boundary');
  assert.equal(subject.get().moveContent('local', key, -1), false);
  assert.equal(subject.saves(), 0);
  assert.equal(subject.get().moveContent('local', key, 1), true);
  assert.deepEqual(Array.from(subject.get().contentPresentation.local.order), [c, absent, b, key]);
  assert.equal(subject.get().terminals, terminals);
  assert.deepEqual(terminals.local.map(term => term.id), ['shell', 'b', 'c']);
  const scope = subject.get().contentPresentation.local;
  assert.deepEqual(Array.from(metadata.sortContentPresentation(inventory.deriveWorkspaceContentInventory(terminals.local, {}), scope), item => item.id), [c, b, key]);
  assert.equal(subject.get().moveContent('local', key, 0), false);
  assert.equal(subject.get().moveContent('local', absent, -1), false, 'Dormant metadata is not a live target');
  subject.get().setContentDisplayAlias('local', key, 'Alias');
  assert.deepEqual(Array.from(subject.get().contentPresentation.local.order), [c, absent, b, key]);
  subject.get().resetContentOrder('local');
  assert.equal(subject.get().contentPresentation.local.order, undefined);
  assert.equal(subject.get().contentPresentation.local.items[c].pinned, true);
  assert.equal(subject.get().contentPresentation.local.items[key].displayAlias, 'Alias');
});

test('order-only close cleanup and blocked/capped mutations preserve unrelated metadata', () => {
  const subject = store();
  const b = '["term","b"]';
  subject.set({ terminals: { local: [{ id: 'shell', title: 'Shell' }, { id: 'b', title: 'B' }] } });
  assert.equal(subject.get().moveContent('local', key, 1), true);
  assert.equal(Object.keys(subject.get().contentPresentation.local.items).length, 0);
  subject.get().forgetContentPresentation('local', [key]);
  assert.deepEqual(Array.from(subject.get().contentPresentation.local.order), [b]);
  subject.set({ sessionPersistenceBlocked: true });
  const before = subject.get().contentPresentation;
  assert.equal(subject.get().setContentPinned('local', b, true), false);
  assert.equal(subject.get().moveContent('local', b, -1), false);
  subject.get().resetContentOrder('local');
  assert.equal(subject.get().contentPresentation, before);
  subject.set({ sessionPersistenceBlocked: false });
  subject.get().forgetContentPresentation('local', [b]);
  assert.equal(subject.get().contentPresentation.local, undefined);

  const order = Array.from({ length: 256 }, (_, i) => `["term","absent-${i}"]`);
  subject.set({ contentPresentation: { local: { version: 2, items: {}, order } } });
  assert.equal(subject.get().setContentPinned('local', key, true), false);
  assert.equal(subject.get().moveContent('local', key, 1), false);
  assert.equal(subject.get().contentPresentation.local.order, order);
  subject.get().resetContentOrder('local');
  assert.equal(subject.get().setContentPinned('local', key, true), true);
});

test('v3 hidden metadata retains prior aliases and pins while rejecting invalid flags and future schemas', () => {
  for (const version of [1, 2]) {
    const scope = { version, items: { [key]: { displayAlias: 'Preserved', ...(version === 2 && { pinned: true }) } },
      ...(version === 2 && { order: [key] }) };
    const parsed = metadata.parseContentPresentation({ local: scope });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.value.local.version, 3);
    assert.equal(parsed.value.local.items[key].displayAlias, 'Preserved');
    assert.equal(parsed.value.local.items[key].pinned, version === 2 ? true : undefined);
  }
  const parsed = metadata.parseContentPresentation({ local: { version: 3, items: { [key]: { hidden: false, pinned: true } }, order: [key] } });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.local.items[key].hidden, undefined);
  assert.equal(parsed.value.local.items[key].pinned, true);
  for (const scope of [
    { version: 4, items: {} },
    { version: 3, items: { [key]: { hidden: null } } },
    { version: 3, items: { [key]: { hidden: 'true' } } },
    { version: 3, items: { [key]: { hidden: true, future: true } } },
    { version: 2, items: { [key]: { hidden: true } } },
  ]) assert.equal(metadata.parseContentPresentation({ local: scope }).ok, false);
});

test('hidden selector uses only canonical live IDs and leaves sorting/recovery inventory intact', () => {
  const absent = '["plugin","owner:panel","absent"]';
  const other = '["term","other"]';
  const items = Object.freeze([{ id: key }, { id: other }]);
  const scope = { version: 3, items: { [key]: { hidden: true }, [absent]: { hidden: true } } };
  assert.deepEqual(Array.from(metadata.hiddenContentIds(items, scope)), [key]);
  assert.equal(metadata.hiddenContentIds(items, undefined).size, 0);
  assert.deepEqual(Array.from(metadata.sortContentPresentation(items, scope), item => item.id), [key, other]);
  assert.equal(items.length, 2);
});

test('hide/reveal changes only metadata and resolves current canonical content on every action', () => {
  const subject = store();
  const terminals = subject.get().terminals;
  const groups = subject.get().paneLayouts;
  subject.get().setContentDisplayAlias('local', key, 'Alias');
  subject.get().setContentPinned('local', key, true);
  assert.equal(subject.get().setContentHidden('local', key, true), true);
  assert.equal(subject.get().contentPresentation.local.items[key].hidden, true);
  const saves = subject.saves();
  assert.equal(subject.get().setContentHidden('local', key, true), true);
  assert.equal(subject.saves(), saves);
  subject.get().setContentDisplayAlias('local', key, 'Renamed');
  subject.get().setContentPinned('local', key, false);
  assert.equal(subject.get().contentPresentation.local.items[key].hidden, true);
  assert.equal(subject.get().setContentHidden('local', key, false), true);
  assert.equal(subject.get().contentPresentation.local.items[key].displayAlias, 'Renamed');
  assert.equal(subject.get().terminals, terminals);
  assert.equal(subject.get().paneLayouts, groups);
  assert.equal(subject.get().terminals.local[0].tabVisible, false);
  subject.set({ terminals: {} });
  assert.equal(subject.get().setContentHidden('local', key, true), false, 'Closed instances are not recreated');
  assert.equal(subject.get().setContentHidden('local', key, null), false);
});

test('reveal all is atomic, cap-safe and preserves aliases, pins, order and dormant identities', () => {
  const subject = store();
  const order = Array.from({ length: 256 }, (_, i) => `["term","saved-${i}"]`);
  const items = Object.fromEntries(order.map((id, i) => [id, { hidden: true, ...(i === 0 && { displayAlias: 'Dormant', pinned: true }) }]));
  subject.set({ contentPresentation: { local: { version: 3, items, order } } });
  assert.equal(subject.get().setContentHidden('local', key, true), false, 'Do not evict dormant IDs at the cap');
  subject.set({ sessionPersistenceBlocked: true });
  assert.equal(subject.get().revealAllContent('local'), false);
  assert.equal(subject.get().contentPresentation.local.items, items);
  subject.set({ sessionPersistenceBlocked: false });
  assert.equal(subject.get().revealAllContent('local'), true);
  assert.equal(subject.saves(), 1, 'One metadata update and save for the complete scope');
  const revealed = subject.get().contentPresentation.local;
  assert.equal(revealed.order, order);
  assert.equal(revealed.items[order[0]].displayAlias, 'Dormant');
  assert.equal(revealed.items[order[0]].pinned, true);
  assert.equal(revealed.items[order[0]].hidden, undefined);
  assert.equal(Object.keys(revealed.items).length, 1);
  assert.equal(subject.get().revealAllContent('local'), true);
  assert.equal(subject.saves(), 1);
  assert.equal(subject.get().revealAllContent('missing'), true);
  assert.equal(subject.get().revealAllContent(''), false);
});
