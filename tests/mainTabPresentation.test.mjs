import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadWorkspaceDomain } from './helpers/loadWorkspaceDomain.mjs';

function loadSource(path, dependencies = {}, globals = {}) {
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../src/${path}.ts`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const context = { exports: {}, require: name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, ...globals };
    runInNewContext(outputText, context);
    return context.exports;
}
const presentation = loadSource('features/workspace/domain/presentation');
const main = loadWorkspaceDomain('features/workspace/domain/mainTabPresentation.ts');
const tabService = loadSource('features/connections/application/tabService', {
    '../domain/connectionDisplay.js': { getConnectionPrimaryLabel: connection => connection.name },
    '../../../lib/terminal/connectionIds.js': { LOCAL_TERMINAL_CONNECTION_ID: 'local' },
}, { crypto: { randomUUID } });
const pin = { version: 2, pinned: true };
const tab = (id, pinned = false) => ({ id, type: 'connection', title: id, connectionId: 'local', view: 'terminal',
    ...(pinned && { presentation: pin }) });
const copy = value => structuredClone(value);
const cases = JSON.parse(readFileSync(new URL('./fixtures/mainTabPresentation.json', import.meta.url), 'utf8'));

test('renderer and native share bounded decoration and migration fixtures', () => {
    for (const item of cases) {
        const parsed = main.parseMainTabPresentation(item.value);
        assert.equal(parsed.ok, item.valid, item.name);
        if (Object.hasOwn(item, 'normalized')) assert.deepEqual(copy(parsed.value ?? null), item.normalized, item.name);
    }
    assert.ok(Object.isFrozen(main.MAIN_TAB_ICONS));
    assert.equal(new Set(main.MAIN_TAB_ICONS.map(icon => icon.id)).size, 8);
    for (const icon of main.MAIN_TAB_ICONS) {
        assert.ok(Object.isFrozen(icon)); assert.ok(icon.label);
        assert.equal(main.parseMainTabPresentation({ version: 2, icon: icon.id }).value.icon, icon.id);
    }
    assert.equal(main.parseMainTabPresentation(Object.create({ version: 2, pinned: true })).ok, false);
    const ownVersion = Object.assign(Object.create({ pinned: true, icon: 'star' }), { version: 2 });
    assert.equal(main.parseMainTabPresentation(ownVersion).value, undefined, 'Inherited metadata is not persisted');
});

test('single preference edits retain other decoration and reset appearance retains pin order', () => {
    const original = { version: 2, pinned: true, icon: 'star', accent: '#AABBCC', closeButton: 'hidden' };
    const before = copy(original);
    const unpinned = main.changeMainTabPresentation(original, { type: 'set-pinned', pinned: false });
    assert.deepEqual(copy(unpinned), { ok: true, changed: true, value: { version: 2, icon: 'star', accent: '#aabbcc', closeButton: 'hidden' } });
    const reset = main.changeMainTabPresentation(original, { type: 'reset-appearance' });
    assert.deepEqual(copy(reset.value), pin); assert.equal(reset.changed, true);
    assert.deepEqual(original, before);
    let current;
    for (const [type, field, value] of [
        ['set-icon', 'icon', 'none'], ['set-accent', 'accent', '#ABCDEF'], ['set-close-button', 'closeButton', 'always'],
    ]) {
        const action = { type, [field]: value };
        const changed = main.changeMainTabPresentation(current, action);
        assert.equal(changed.ok, true); assert.equal(changed.changed, true);
        current = changed.value;
        assert.equal(main.changeMainTabPresentation(current, action).changed, false, 'Canonical no-ops do not save');
        const cleared = main.changeMainTabPresentation(current, { type, [field]: undefined });
        assert.equal(cleared.changed, true);
        assert.equal(cleared.value?.[field], undefined);
        assert.equal(main.changeMainTabPresentation(cleared.value, { type, [field]: undefined }).changed, false);
    }
    assert.equal(main.changeMainTabPresentation({ version: 1, pinned: true }, { type: 'set-pinned', pinned: true }).changed, false);
    assert.equal(main.changeMainTabPresentation(current, { type: 'reset-appearance' }).value, undefined);
});

test('invalid intents and unsupported existing metadata cannot be partially changed or reset', () => {
    const original = Object.freeze({ version: 2, icon: 'folder', closeButton: 'active' });
    const invalid = [null, [], {}, { type: 'set-icon' }, { type: 'set-icon', icon: null },
        { type: 'set-icon', icon: 'https://example.com/a.svg' }, { type: 'set-pinned', pinned: 1 },
        { type: 'set-accent', accent: '#fff' }, { type: 'set-accent', accent: '#123456\n' },
        { type: 'set-close-button', closeButton: 'hover' }, { type: 'reset-appearance', pinned: false },
        { type: 'set-icon', icon: 'star', connectionId: 'other' }, { type: 'unknown' },
        Object.create({ type: 'reset-appearance' })];
    for (const action of invalid) assert.equal(main.changeMainTabPresentation(original, action).ok, false);
    for (const item of cases.filter(item => !item.valid)) {
        const before = copy(item.value);
        assert.equal(main.changeMainTabPresentation(item.value, { type: 'reset-appearance' }).ok, false, item.name);
        assert.deepEqual(item.value, before);
    }
});

/** Production reducers execute normally; unused network/native dependencies expose no methods. */
function store(tabs = []) {
    const { outputText } = ts.transpileModule(readFileSync(new URL('../src/store/connectionSlice.ts', import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const context = { exports: {}, console, require: name => {
        if (name.endsWith('/workspace/domain/presentation')) return presentation;
        if (name.endsWith('/workspace/domain/mainTabPresentation')) return main;
        if (name.endsWith('/application/tabService')) return tabService;
        if (name.endsWith('/vault/profileTypes')) return { DEFAULT_VAULT_PROFILE_ID: 'default', isVaultProfileId: () => false };
        return {};
    } };
    runInNewContext(outputText, context);
    let state;
    let saves = 0;
    const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = { ...context.exports.createConnectionSlice(set, () => state, {}), tabs,
        sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false,
        terminals: {}, paneLayouts: {}, contentPresentation: {}, saveSession: async () => { saves++; } };
    return { get: () => state, set, saves: () => saves };
}

test('main-tab envelope accepts missing/known metadata and rejects every unknown or invalid shape', () => {
    for (const raw of [undefined, { version: 1 }, { version: 1, pinned: false }]) {
        const parsed = main.parseMainTabPresentation(raw);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.value, undefined);
    }
    assert.equal(main.parseMainTabPresentation(pin).value.pinned, true);
    for (const raw of [null, [], true, 1, {}, { pinned: true }, { version: 0 }, { version: 3 },
        { version: 1, hidden: true }, { version: 1, pinned: null }, { version: 1, pinned: 'true' }]) {
        assert.equal(main.parseMainTabPresentation(raw).ok, false);
        assert.throws(() => main.assertSupportedMainTabPresentations([{ id: 'unsupported', presentation: raw }]), /SESSION_UNSUPPORTED_VERSION/);
    }
});

test('stable partition and stable-ID movement preserve references and keep pin buckets separate', () => {
    const a = tab('a'), b = tab('b', true), c = tab('c'), d = tab('d', true);
    const original = [a, b, c, d];
    const ordered = main.stablePinnedMainTabs(original);
    assert.deepEqual(Array.from(ordered), [b, d, a, c]);
    assert.equal(main.stablePinnedMainTabs(ordered), ordered);
    assert.deepEqual(Array.from(main.reorderMainTabsById(ordered, 'b', 'd')), [d, b, a, c]);
    assert.deepEqual(Array.from(main.reorderMainTabsById(ordered, 'a', 'c')), [b, d, c, a]);
    for (const [from, to] of [['a', 'b'], ['b', 'c'], ['missing', 'b'], ['b', 'missing'], ['b', 'b']]) {
        assert.equal(main.reorderMainTabsById(ordered, from, to), ordered);
    }
    const duplicate = [a, a, c];
    assert.equal(main.reorderMainTabsById(duplicate, 'a', 'c'), duplicate);
    assert.deepEqual(original, [a, b, c, d]);
});

test('pinning partitions only tab metadata without activating or altering content and no-op pins do not save', () => {
    const a = tab('a'), b = tab('b', true), c = tab('c');
    const subject = store([b, a, c]);
    subject.set({ activeTabId: 'a', activeConnectionId: 'local' });
    const before = subject.get();
    assert.equal(subject.get().setTabPinned('c', true), true);
    assert.deepEqual(Array.from(subject.get().tabs, item => item.id), ['b', 'c', 'a']);
    assert.equal(subject.get().tabs[0], b);
    assert.equal(subject.get().tabs[2], a);
    assert.equal(subject.get().activeTabId, before.activeTabId);
    for (const name of ['connections', 'terminals', 'paneLayouts', 'contentPresentation']) assert.equal(subject.get()[name], before[name]);
    assert.equal(subject.get().setTabPinned('c', true), true);
    assert.equal(subject.saves(), 1);
    assert.equal(subject.get().setTabPinned('b', false), true);
    assert.deepEqual(Array.from(subject.get().tabs, item => item.id), ['c', 'b', 'a']);
    assert.equal(subject.get().tabs[1].presentation, undefined);
});

test('pin and reorder actions reject loading/restoring/blocked/stale state without mutations or save attempts', () => {
    for (const guard of [{ sessionLoaded: false }, { isRestoring: true }, { sessionPersistenceBlocked: true }]) {
        const subject = store([tab('a'), tab('b')]);
        subject.set(guard);
        const before = subject.get().tabs;
        assert.equal(subject.get().setTabPinned('a', true), false);
        assert.equal(subject.get().updateTabPresentation('a', { type: 'set-icon', icon: 'star' }), false);
        assert.equal(subject.get().setTabDisplayAlias('a', 'Blocked edit'), false);
        subject.get().reorderWorkspaceTab('a', 'b');
        subject.get().reorderTabs(0, 1);
        assert.equal(subject.get().tabs, before);
        assert.equal(subject.saves(), 0);
    }
    const subject = store([tab('a')]);
    const before = subject.get().tabs;
    for (const [id, pinned] of [['gone', true], ['a', null], ['a', 'true']]) assert.equal(subject.get().setTabPinned(id, pinned), false);
    assert.equal(subject.get().tabs, before);
    assert.equal(subject.saves(), 0);
});

test('unknown in-memory metadata is preserved before pinning can replace its envelope', () => {
    const future = { ...tab('a'), presentation: { version: 3, pinned: true, future: 'keep' } };
    const subject = store([future, tab('b')]);
    const before = subject.get().tabs;
    assert.equal(subject.get().setTabPinned('a', false), false);
    assert.equal(subject.get().updateTabPresentation('a', { type: 'reset-appearance' }), false);
    assert.equal(subject.get().setTabDisplayAlias('a', 'Do not replace'), false);
    subject.get().reorderWorkspaceTab('a', 'b');
    assert.equal(subject.get().tabs, before);
    assert.equal(subject.get().tabs[0], future);
});

test('real store display edits preserve resources, pin decoration, aliases and unaffected tab references', () => {
    const a = { ...tab('a'), displayAlias: 'Build', presentation: { version: 2, icon: 'star', accent: '#123456', closeButton: 'hidden' } };
    const b = tab('b');
    const subject = store([b, a]);
    subject.set({ activeTabId: 'b', activeConnectionId: 'local' });
    const before = subject.get();
    assert.equal(subject.get().setTabPinned('a', true), true);
    assert.deepEqual(copy(subject.get().tabs[0].presentation), { ...a.presentation, pinned: true });
    assert.equal(subject.get().setTabPinned('a', false), true);
    assert.deepEqual(copy(subject.get().tabs[0].presentation), a.presentation);
    assert.equal(subject.get().tabs[1], b);
    assert.equal(subject.get().updateTabPresentation('a', { type: 'set-accent', accent: '#ABCDEF' }), true);
    const decorated = subject.get().tabs[0];
    assert.equal(decorated.presentation.accent, '#abcdef');
    assert.equal(decorated.displayAlias, a.displayAlias);
    assert.equal(subject.get().updateTabPresentation('a', { type: 'set-accent', accent: '#ABCDEF' }), true);
    assert.equal(subject.get().tabs[0], decorated);
    assert.equal(subject.saves(), 3);
    for (const name of ['connections', 'terminals', 'paneLayouts', 'contentPresentation', 'activeTabId', 'activeConnectionId']) {
        assert.equal(subject.get()[name], before[name], name);
    }
    assert.equal(subject.get().updateTabPresentation('gone', { type: 'reset-appearance' }), false);
    assert.equal(subject.get().updateTabPresentation('a', { type: 'set-accent', accent: 'red' }), false);
    subject.set({ tabs: [decorated, decorated] });
    assert.equal(subject.get().updateTabPresentation('a', { type: 'reset-appearance' }), false);
    assert.equal(subject.saves(), 3);
});

test('restore migrates legacy pins and retains unpinned icons/accents/close preferences', () => {
    const subject = store();
    const metadata = { version: 2, pinned: false, icon: 'none', accent: '#ABCDEF', closeButton: 'active' };
    subject.get().restoreTabState([
        { ...tab('a'), tabType: 'connection', presentation: metadata },
        { ...tab('b'), tabType: 'connection', presentation: { version: 1, pinned: true } },
    ], 'a', 'local');
    assert.deepEqual(copy(subject.get().tabs[0].presentation), pin);
    assert.deepEqual(copy(subject.get().tabs[1].presentation), { version: 2, icon: 'none', accent: '#abcdef', closeButton: 'active' });
    assert.equal(metadata.pinned, false); assert.equal(metadata.accent, '#ABCDEF');
    assert.equal(subject.get().activeTabId, 'a'); assert.equal(subject.saves(), 0);
});

test('alias action reports stale/ambiguous targets and accepted no-op edits without unnecessary saves', () => {
    const a = { ...tab('a'), displayAlias: 'Keep' };
    const subject = store([a]);
    assert.equal(subject.get().setTabDisplayAlias('missing', 'No'), false);
    assert.equal(subject.get().setTabDisplayAlias('a', 'Keep'), true);
    assert.equal(subject.saves(), 0);
    subject.set({ tabs: [a, { ...a }] });
    assert.equal(subject.get().setTabDisplayAlias('a', 'Ambiguous'), false);
    assert.equal(subject.saves(), 0);
    assert.equal(subject.get().tabs[0], a);
});

test('restore partitions pins, normalizes false and validates even snapshots that would be filtered out', () => {
    const subject = store();
    const snapshots = [
        { ...tab('a'), tabType: 'connection', presentation: { version: 1, pinned: false } },
        { ...tab('b', true), tabType: 'connection' },
        { ...tab('c', true), tabType: 'connection' },
    ];
    subject.get().restoreTabState(snapshots, 'a', 'local');
    assert.deepEqual(Array.from(subject.get().tabs, item => item.id), ['b', 'c', 'a']);
    assert.equal(subject.get().activeTabId, 'a');
    assert.equal(subject.get().tabs[2].presentation, undefined);
    const before = subject.get().tabs;
    assert.throws(() => subject.get().restoreTabState([...snapshots,
        { id: 'future', tabType: 'settings', presentation: { version: 3 } }], 'a', 'local'), /SESSION_UNSUPPORTED_VERSION/);
    assert.equal(subject.get().tabs, before);
});

test('new tabs append unpinned after restored pins and index reorder obeys bucket limits', () => {
    const existing = { ...tab('pinned', true), connectionId: 'remote' };
    const subject = store([existing]);
    subject.get().openTab('local');
    const tabs = subject.get().tabs;
    assert.equal(tabs[0], existing);
    assert.equal(tabs[1].connectionId, 'local');
    assert.equal(tabs[1].presentation, undefined);
    subject.get().reorderTabs(1, 0);
    assert.equal(subject.get().tabs, tabs);
    subject.get().openTab('local');
    assert.equal(subject.get().tabs, tabs, 'Activating existing local tab cannot reopen or reshuffle it');
});
