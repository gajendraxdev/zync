import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadWorkspaceDomain } from './helpers/loadWorkspaceDomain.mjs';
import * as presentation from '../.tmp-agent-tests/src/features/workspace/domain/presentation.js';
import { buildSessionData } from '../.tmp-agent-tests/src/store/sessionPersistence.js';
import { DEFAULT_VAULT_PROFILE_ID, isVaultProfileId } from '../.tmp-agent-tests/src/vault/profileTypes.js';

const { normalizeDisplayAlias, parseDisplayAliasDraft, resolveDisplayTitle, reorderItemsById } = presentation;
const mainTabPresentation = loadWorkspaceDomain('features/workspace/domain/mainTabPresentation.ts');

test('interactive alias validation counts canonical text and never truncates an overlong draft', () => {
    for (const [value, expected] of [
        ['e\u0301'.repeat(80), 'é'.repeat(80)],
        ['  Work' + ' \t\u202e'.repeat(100) + 'host  ', 'Work host'],
        ['😀'.repeat(80), '😀'.repeat(80)],
        ['\u200b\u2060\u202e', undefined],
    ]) {
        assert.deepEqual(parseDisplayAliasDraft(value), { ok: true, alias: expected });
    }
    for (const value of ['x'.repeat(81), '😀'.repeat(81), '\u0344'.repeat(41)]) {
        // NFC expands U+0344 into two combining marks; validate after that expansion too.
        assert.deepEqual(parseDisplayAliasDraft(value), { ok: false, reason: 'too-long' });
        assert.equal(Array.from(normalizeDisplayAlias(value)).length, 80, 'Persistence remains bounded for legacy input');
    }
});

test('aliases normalize Unicode text and reject malformed values without becoming identifiers', () => {
    for (const value of [undefined, null, 123, {}, [], '', ' \n\t ', '\u202e', '\u200b', '\u2060']) {
        assert.equal(normalizeDisplayAlias(value), undefined);
    }
    assert.equal(normalizeDisplayAlias('  Cafe\u0301  🐱 工作  '), 'Café 🐱 工作');
    assert.equal(normalizeDisplayAlias('A\u202eB\nC'), 'A B C');
    assert.equal(Array.from(normalizeDisplayAlias('🐱'.repeat(100))).length, 80);
    assert.equal(resolveDisplayTitle('Server', 'Build host'), 'Build host');
    assert.equal(resolveDisplayTitle('New server title', ' '), 'New server title');
});

test('reorder operates on stable IDs, shares item identity and handles stale or ambiguous targets', () => {
    const a = { id: 'a' }, b = { id: 'b' }, c = { id: 'c' };
    const items = [a, b, c];
    assert.deepEqual(reorderItemsById(items, 'a', 'c'), [b, c, a]);
    assert.deepEqual(reorderItemsById(items, 'c', 'a'), [c, a, b]);
    for (const [from, to] of [['a', 'a'], ['missing', 'a'], ['a', 'missing']]) {
        assert.equal(reorderItemsById(items, from, to), items);
    }
    const duplicate = [a, b, a];
    assert.equal(reorderItemsById(duplicate, 'a', 'b'), duplicate);
    assert.deepEqual(items, [a, b, c]);
});

/** Execute the production slice with IPC/lifecycle imports isolated, not its reducers mocked. */
function connectionStore() {
    const { outputText } = ts.transpileModule(readFileSync('src/store/connectionSlice.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    runInNewContext(outputText, {
        exports: module.exports,
        require: id => {
            if (id.endsWith('/workspace/domain/presentation')) return presentation;
            if (id.endsWith('/workspace/domain/mainTabPresentation')) return mainTabPresentation;
            if (id.endsWith('/vault/profileTypes')) return { DEFAULT_VAULT_PROFILE_ID, isVaultProfileId };
            if (id.endsWith('/application/tabService')) return { GLOBAL_SNIPPETS_CONNECTION_ID: 'global-snippets', LOCAL_TERMINAL_CONNECTION_ID: 'local' };
            // These imported services are never invoked by the presentation actions.
            return {};
        },
        console,
    });
    let saves = 0;
    let state;
    const set = update => { state = { ...state, ...(typeof update === 'function' ? update(state) : update) }; };
    state = {
        ...module.exports.createConnectionSlice(set, () => state, {}),
        sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false,
        saveSession: async () => { saves++; },
    };
    return { get: () => state, set, saves: () => saves };
}

test('alias actions preserve resource identity, dynamic titles and host configuration', () => {
    const store = connectionStore();
    const connection = { id: 'host', name: 'Actual host', host: 'localhost', status: 'disconnected' };
    const tab = { id: 'workspace', type: 'connection', title: 'Actual host', connectionId: 'host', view: 'terminal' };
    store.set({ connections: [connection], tabs: [tab] });
    store.get().setTabDisplayAlias('workspace', '  My workspace ');
    assert.equal(store.get().tabs[0].displayAlias, 'My workspace');
    assert.equal(store.get().tabs[0].id, tab.id);
    assert.equal(store.get().tabs[0].title, tab.title);
    assert.equal(store.get().tabs[0].connectionId, tab.connectionId);
    assert.equal(store.get().connections[0], connection);
    const aliased = store.get().tabs;
    store.get().setTabDisplayAlias('missing', 'No-op');
    assert.equal(store.get().tabs, aliased);
    store.get().setTabDisplayAlias('workspace', undefined);
    assert.equal(store.get().tabs[0].displayAlias, undefined);
    assert.equal(resolveDisplayTitle(store.get().tabs[0].title), 'Actual host');
});

test('legacy index reorder delegates safely and stale drag IDs cannot insert undefined tabs', () => {
    const store = connectionStore();
    const tabs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    store.set({ tabs });
    for (const [from, to] of [[-1, 0], [0, -1], [0, 3], [0.5, 1], [NaN, 1], [0, Infinity]]) {
        store.get().reorderTabs(from, to);
        assert.equal(store.get().tabs, tabs);
    }
    store.get().reorderWorkspaceTab('gone', 'a');
    assert.equal(store.get().tabs, tabs);
    store.get().reorderTabs(0, 2);
    assert.deepEqual(Array.from(store.get().tabs, tab => tab.id), ['b', 'c', 'a']);
});

test('session snapshot and restore roundtrip aliases independently of canonical titles', () => {
    const store = connectionStore();
    store.set({ tabs: [{ id: 'local-tab', type: 'connection', title: 'Local terminal', connectionId: 'local', view: 'terminal', displayAlias: '  Work  ' }], activeTabId: 'local-tab' });
    const snapshot = buildSessionData({ ...store.get(), terminals: {}, activeTerminalIds: {} });
    assert.equal(snapshot.tabs[0].displayAlias, 'Work');
    assert.equal(snapshot.tabs[0].title, 'Local terminal');
    store.get().restoreTabState(snapshot.tabs, snapshot.activeTabId, 'local');
    assert.equal(store.get().tabs[0].displayAlias, 'Work');
    assert.equal(store.get().tabs[0].title, 'Local terminal');
    const legacy = { ...snapshot.tabs[0] };
    delete legacy.displayAlias;
    store.get().restoreTabState([legacy, legacy, { ...legacy, id: '' }, null], 'local-tab', 'local');
    assert.equal(store.get().tabs.length, 1);
    assert.equal(store.get().tabs[0].displayAlias, undefined);
    store.get().restoreTabState([
        { ...legacy, tabType: 'unknown' },
        { ...legacy, connectionId: 'deleted' },
        legacy,
    ], 'local-tab', 'local');
    assert.equal(store.get().tabs.length, 1, 'Invalid snapshots cannot shadow a later valid duplicate');
    assert.equal(store.get().tabs[0].connectionId, 'local');
});
