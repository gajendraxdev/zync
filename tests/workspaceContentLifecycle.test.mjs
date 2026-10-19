import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';
import * as compiledLayout from '../.tmp-agent-tests/src/lib/paneLayout/index.js';
import * as dockingTopology from '../.tmp-agent-tests/src/features/workspace/domain/dockingTopology.js';
import * as dockingView from '../.tmp-agent-tests/src/features/workspace/domain/dockingView.js';
import * as canvases from '../.tmp-agent-tests/src/features/workspace/domain/canvases.js';
import * as docking from '../.tmp-agent-tests/src/features/workspace/domain/docking.js';
import * as regions from '../.tmp-agent-tests/src/lib/paneLayout/regions.js';
import { loadWorkspaceDomain } from './helpers/loadWorkspaceDomain.mjs';

function loadSource(path, dependencies = {}, globals = {}) {
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    const context = { exports: {}, require: name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    }, ...globals };
    runInNewContext(outputText, context);
    return context.exports;
}
const identity = loadSource('src/lib/paneLayout/contentIdentity.ts');
const layout = { ...compiledLayout, ...identity };
Object.assign(layout, loadSource('src/lib/paneLayout/visibility.ts', { './contentIdentity': identity, './query': layout }));
const persisted = loadSource('src/lib/paneLayout/persist.ts', { './ops': layout, './query': layout, './types': layout });
Object.assign(layout, persisted);
const groups = loadSource('src/lib/paneLayout/groups.ts', { './persist': layout, './ops': layout, './query': layout, './contentIdentity': identity });
Object.assign(layout, groups);
const inventory = loadSource('src/features/workspace/domain/contentInventory.ts', {
    '../../../lib/paneLayout/contentIdentity': identity, '../../../lib/paneLayout/query': layout,
});
const presentation = loadSource('src/features/workspace/domain/presentation.ts');
const metadata = loadSource('src/features/workspace/domain/contentPresentation.ts', { './presentation': presentation });
const visibility = loadSource('src/features/workspace/domain/visibleContent.ts', {
    '../../../lib/paneLayout': layout, './contentInventory': inventory, './contentPresentation': metadata,
});
const registrations = loadSource('src/features/workspace/domain/registrations.ts', { '../../../lib/paneLayout/types': layout, '../../../lib/paneLayout/regions': regions });
const panels = loadSource('src/features/plugins/application/pluginPanelInventory.ts');
const adapter = loadSource('src/features/workspace/application/viewRegistrationAdapters.ts', {
    '../../../lib/paneLayout/regions': regions,
    '../../plugins/application/pluginPanelInventory': panels, '../domain/registrations': registrations,
});
const key = pane => identity.paneContentKey(pane.content, pane.id);
test('terminal focus lookup accepts empty visible projections at its existing nullable boundary', () => {
    assert.equal(layout.layoutActiveTermId(null), null);
    assert.equal(layout.layoutActiveTermId(undefined), null);
});
const plugin = (instance, paneId = `pane-${instance}`) => layout.singlePluginPane('owner:panel', paneId, instance);
const split = (first, second) => layout.splitPane(first, layout.collectLeaves(first.root)[0].id, 'horizontal', second.root.content, 4, 'after', second.root.id).layout;

function harness(paneGroups, { multiple = true, blocked = false } = {}) {
    const calls = { killed: [], destroyed: [], forgotten: [], warnings: [], copies: [], scheduled: 0, saves: 0, closeChecks: 0 };
    let state;
    const slice = loadSource('src/store/terminalSlice.ts', {
        '../features/usage': { track: () => {} },
        '../lib/terminal': { terminalService: { destroy: id => calls.destroyed.push(id) } },
        './sessionSlice': { scheduleSaveSession: () => { calls.scheduled++; } },
        '../lib/paneCloseBlockers': {
            isPaneCloseBlocked: () => { calls.closeChecks++; return blocked; },
            isPaneLayoutCloseBlocked: () => { calls.closeChecks++; return blocked; },
            paneCloseScope: () => ({}),
        },
        '../lib/paneLayout': layout,
        '../lib/paneLayout/groups': groups,
        '../features/workspace/application/viewRegistrationAdapters': adapter,
        '../features/workspace/domain/dockingTopology': dockingTopology,
        '../features/workspace/domain/canvases': canvases,
        '../features/workspace/domain/docking': docking,
        '../features/workspace/domain/paneTabRelease': loadWorkspaceDomain('features/workspace/domain/paneTabRelease.ts'),
        '../features/workspace/domain/contentPresentation': metadata,
    }, { window: { ipcRenderer: { send: (...args) => calls.killed.push(args) } }, crypto: webcrypto });
    const set = patch => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
    state = {
        ...slice.createTerminalSlice(set, () => state),
        paneLayouts: { local: paneGroups }, activePaneGroupOwner: { local: Object.keys(paneGroups)[0] },
        aiConversations: {}, aiDisplayHistory: {},
        connections: [],
        contentPresentation: { local: { items: Object.fromEntries(inventory.deriveWorkspaceContentInventory([], paneGroups).map(item => [item.id, { displayAlias: `Alias ${item.id}` }])) } },
        workspaceViewRegistry: adapter.buildWorkspaceViewRegistrations([{ id: 'owner:panel', pluginId: 'owner', title: 'Plugin', allowMultiple: multiple }]),
        showToast: (...args) => calls.warnings.push(args),
        saveSession: () => { calls.saves++; },
        copyFilesListing: (...args) => calls.copies.push(args),
        forgetClosedWorkspaceDocking: () => {},
        forgetContentPresentation: (_scope, keys) => {
            calls.forgotten.push(...keys);
            for (const id of keys) delete state.contentPresentation.local.items[id];
        },
    };
    return { get: () => state, set, calls };
}

function tabBarCallbacks(subject, overrides = {}) {
    const store = Object.assign(selector => selector(subject.get()), { getState: subject.get });
    const component = loadSource('src/components/layout/WorkspaceTabBar.tsx', {
        react: { memo: component => component, useMemo: fn => fn() },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
        '../../store/useAppStore': { useAppStore: store },
        '../../hooks/useAvailableShells': { useAvailableShells: () => ({ shells: [], isLoading: false }) },
        '../../features/connections/application/tabService': { LOCAL_TERMINAL_CONNECTION_ID: 'local' },
        './CombinedTabBar': { CombinedTabBar: () => null },
        './tabDock': { overlayPaneId: id => `overlay:${id}`, overlayPluginPaneId: id => `overlay:plugin:${id}` },
        '../../features/workspace/domain/contentInventory': inventory,
        '../../features/workspace/domain/visibleContent': visibility,
        '../../features/workspace/domain/dockingTopology': dockingTopology,
        '../../features/workspace/domain/dockingView': dockingView,
        '../../lib/paneLayout': layout,
    }, { window: {} });
    return component.WorkspaceTabBar({ connectionId: 'local', tabId: 'main', activeView: 'plugin:owner:panel',
        featureTabs: [], activeFeatureTabId: null, pinnedFeatures: [], pluginPanels: [], ...overrides }).props;
}

// Execute the real composition callback with the real store action/pure inventory.
// JSX extraction avoids importing native app composition into this behavior test.
const mainLayoutSource = ts.createSourceFile('MainLayout.tsx', readFileSync(new URL('../src/components/layout/MainLayout.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let pluginCloseCallback;
let groupCloseCallback;
function findPluginCloseCallback(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handlePluginTabClose') {
        assert.ok(node.initializer && ts.isCallExpression(node.initializer));
        pluginCloseCallback = node.initializer.arguments[0].getText(mainLayoutSource);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handlePaneGroupClose') {
        assert.ok(node.initializer && ts.isCallExpression(node.initializer));
        groupCloseCallback = node.initializer.arguments[0].getText(mainLayoutSource);
    }
    ts.forEachChild(node, findPluginCloseCallback);
}
findPluginCloseCallback(mainLayoutSource);
assert.ok(pluginCloseCallback, 'production plugin close callback exists');
assert.ok(groupCloseCallback, 'production group close callback exists');
const closeCallbackScript = ts.transpileModule(`globalThis.closeTab = ${pluginCloseCallback}`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
function pluginTabClose(subject, view, pinnedFeatures = []) {
    const effects = { selected: [], views: [], toggles: [] };
    const context = {
        tab: { id: 'main', connectionId: 'local', view },
        useAppStore: { getState: subject.get },
        findWorkspaceContentPane: inventory.findWorkspaceContentPane,
        deriveWorkspaceContentInventory: inventory.deriveWorkspaceContentInventory,
        isPluginContent: layout.isPluginContent, isSplitLayout: layout.isSplitLayout,
        pinnedFeatures,
        toggleConnectionFeature: (...args) => effects.toggles.push(args),
        handlePluginTabSelect: id => effects.selected.push(id),
        setTabView: (...args) => effects.views.push(args),
    };
    runInNewContext(closeCallbackScript, context);
    return { close: context.closeTab, effects };
}

test('production tab adapter closes the whole canonical group, including hidden members, through the guarded app callback', () => {
    for (const blocked of [false, true]) {
        const shell = layout.singlePane('shell', 'shell-pane');
        const hiddenShell = layout.singlePane('hidden-shell', 'hidden-shell-pane');
        const joined = split(split(shell, hiddenShell), plugin('plugin'));
        const subject = harness({ shell: joined }, { blocked });
        const hiddenKey = key(hiddenShell.root);
        subject.set({ terminals: { local: [{ id: 'shell', title: 'Shell' }, { id: 'hidden-shell', title: 'Hidden' }] },
            activeTerminalIds: { local: 'shell' },
            contentPresentation: { local: { version: 3, items: { [hiddenKey]: { hidden: true } } } } });
        const effects = [];
        const context = {
            tab: { id: 'main', connectionId: 'local', view: 'terminal' }, useAppStore: { getState: subject.get },
            collectLeaves: layout.collectLeaves, isFeatureContent: layout.isFeatureContent, isPluginContent: layout.isPluginContent,
            deriveWorkspaceContentInventory: inventory.deriveWorkspaceContentInventory,
            featureTabs: [], pinnedFeatures: [],
            setActiveFeatureTabId: id => effects.push(['feature', id]),
            setTabView: (...args) => effects.push(['view', ...args]),
            toggleConnectionFeature: () => { throw Error('No pinned features'); },
            handlePluginTabSelect: () => { throw Error('No surviving plugin'); },
        };
        runInNewContext(ts.transpileModule(`globalThis.closeGroup = ${groupCloseCallback}`, {
            compilerOptions: { target: ts.ScriptTarget.ES2022 },
        }).outputText, context);
        const props = tabBarCallbacks(subject, { onPaneGroupClose: context.closeGroup });
        assert.equal(props.onPaneGroupClose, context.closeGroup, 'Adapter must preserve the one-owner close contract');
        props.onPaneGroupClose('shell');
        assert.equal(subject.calls.closeChecks, 1);
        if (blocked) {
            assert.equal(subject.get().paneLayouts.local.shell, joined);
            assert.deepEqual(subject.calls.killed, []);
            assert.deepEqual(effects, []);
        } else {
            assert.equal(subject.get().paneLayouts.local?.shell, undefined);
            assert.deepEqual(subject.calls.killed.map(([command, payload]) => [command, payload.termId]),
                [['terminal:kill', 'shell'], ['terminal:kill', 'hidden-shell']]);
            assert.equal(subject.get().terminals.local.length, 0);
            assert.equal(subject.get().contentPresentation.local.items[hiddenKey], undefined);
            assert.deepEqual(effects, [['feature', null], ['view', 'main', 'terminal']]);
        }
    }
});

test('mixed inventory locates grouped shells and every same-panel plugin instance exactly once', () => {
    const first = plugin('first');
    const second = plugin('second');
    const shell = layout.singlePane('shell', 'shell-pane');
    const mixed = split(shell, first);
    const items = inventory.deriveWorkspaceContentInventory([{ id: 'shell', title: 'Shell title' }], { shell: mixed, second });
    assert.equal(items.length, 3);
    assert.equal(items[0].owner, 'shell');
    assert.equal(items[0].title, 'Shell title');
    assert.equal(items[0].paneId, 'shell-pane');
    assert.notEqual(items[1].id, items[2].id);
    assert.equal(inventory.findWorkspaceContentPane({ shell: mixed, second }, key(second.root)).pane, second.root);
    assert.equal(inventory.findWorkspaceContentPane({ shell: mixed, second }, 'stale'), undefined);
});

/** Hide fixtures alter decoration only, exactly as the production metadata action does. */
function hideContent(subject, ...panes) {
    const prior = subject.get().contentPresentation.local;
    subject.set({ contentPresentation: { local: { ...prior, items: {
        ...prior.items, ...Object.fromEntries(panes.map(pane => [key(pane), { ...prior.items[key(pane)], hidden: true }])),
    } } } });
}

test('hidden and stale focus targets are refused without changing selection, resources or persistence', () => {
    const first = layout.singlePane('first', 'first-pane');
    const second = layout.singlePane('second', 'second-pane');
    const original = split(first, second);
    const subject = harness({ first: original });
    subject.set({ terminals: { local: [{ id: 'first', title: 'First' }, { id: 'second', title: 'Second', tabVisible: false }] },
        activeTerminalIds: { local: 'first' } });
    hideContent(subject, second.root);
    const before = subject.get();
    subject.get().setActiveTerminal('local', 'second');
    subject.get().setActiveTerminal('local', 'missing');
    subject.get().focusPane('local', second.root.id);
    subject.get().focusPane('local', 'missing');
    assert.equal(subject.get(), before);
    assert.equal(subject.calls.scheduled + subject.calls.killed.length + subject.calls.destroyed.length, 0);
});

test('group activation repairs visible focus without removing hidden leaves and refuses all-hidden groups', () => {
    const first = layout.singlePane('first', 'first-pane');
    const second = layout.singlePane('second', 'second-pane');
    const original = { ...split(first, second), activePaneId: second.root.id };
    const subject = harness({ first: original });
    subject.set({ activeTerminalIds: { local: 'second' }, activePaneGroupOwner: { local: null } });
    hideContent(subject, second.root);
    subject.get().activatePaneGroup('local', 'first');
    assert.equal(subject.get().paneLayouts.local.first.root, original.root);
    assert.equal(subject.get().paneLayouts.local.first.activePaneId, first.root.id);
    assert.equal(subject.get().activeTerminalIds.local, 'first');
    hideContent(subject, first.root);
    subject.set({ activePaneGroupOwner: { local: null } });
    const groupsBefore = subject.get().paneLayouts;
    subject.get().activatePaneGroup('local', 'first');
    assert.equal(subject.get().activePaneGroupOwner.local, null);
    assert.equal(subject.get().paneLayouts, groupsBefore);
    assert.equal(subject.calls.killed.length + subject.calls.destroyed.length + subject.calls.forgotten.length, 0);
});

test('directional focus skips hidden geometry and never chooses hidden terminals as feature fallback', () => {
    const first = layout.singlePane('first', 'first-pane');
    const middle = layout.singlePane('middle', 'middle-pane');
    const last = layout.singleFeaturePane('dashboard', 'last-pane', 'last');
    let original = split(first, middle);
    original = layout.splitPane(original, middle.root.id, 'horizontal', last.root.content, 4, 'after', last.root.id).layout;
    original = { ...original, activePaneId: first.root.id };
    const subject = harness({ first: original });
    subject.set({ activeTerminalIds: { local: 'first' } });
    hideContent(subject, middle.root);
    assert.equal(subject.get().focusPaneInDirection('local', 'right'), true);
    assert.equal(subject.get().paneLayouts.local.first.activePaneId, last.root.id);
    assert.equal(subject.get().activeTerminalIds.local, 'first');
    hideContent(subject, first.root);
    subject.set({ activeTerminalIds: { local: null } });
    subject.get().focusPane('local', last.root.id);
    assert.equal(subject.get().activeTerminalIds.local, null, 'Hidden first terminal is not installed as the input fallback');
    hideContent(subject, last.root);
    assert.equal(subject.get().focusPaneInDirection('local', 'left'), false);
});

test('split targets visible focus but enforces the canonical four-pane cap', () => {
    const first = plugin('first');
    const second = plugin('second');
    const original = { ...split(first, second), activePaneId: first.root.id };
    const subject = harness({ first: original });
    hideContent(subject, first.root);
    assert.equal(subject.get().splitPanes('local'), true);
    const current = subject.get().paneLayouts.local.first;
    assert.equal(layout.collectLeaves(current.root).length, 3);
    assert.equal(current.root.children[0], first.root, 'Hidden branch is retained and is not split');
    assert.equal(layout.collectLeaves(current.root.children[1]).length, 2, 'The visible sibling receives the split');
    let capped = split(original, plugin('third'));
    capped = split(capped, plugin('fourth'));
    subject.set({ paneLayouts: { local: { first: capped } } });
    hideContent(subject, ...layout.collectLeaves(capped.root).filter(pane => pane.id !== second.root.id));
    const before = JSON.stringify(subject.get().paneLayouts);
    const scheduled = subject.calls.scheduled;
    assert.equal(subject.get().splitPanes('local'), false);
    assert.equal(subject.get().dockInSplit('local', { kind: 'feature', featureId: 'files' }, 'right', second.root.id), 'refused-cap');
    assert.equal(JSON.stringify(subject.get().paneLayouts), before);
    assert.equal(subject.calls.scheduled, scheduled);
    assert.equal(subject.calls.copies.length, 0, 'Cap refusal does not copy feature state');
});

test('docking repairs implicit hidden focus but refuses explicit hidden, stale and hidden-source targets', () => {
    const first = plugin('first');
    const second = plugin('second');
    const original = { ...split(first, second), activePaneId: first.root.id };
    const subject = harness({ first: original });
    hideContent(subject, first.root);
    const request = { kind: 'feature', featureId: 'dashboard' };
    assert.equal(subject.get().dockInSplit('local', request, 'right', first.root.id), 'no-target');
    assert.equal(subject.get().dockInSplit('local', request, 'right', 'stale-pane'), 'no-target');
    assert.equal(subject.get().dockInSplit('local', layout.paneDockPayload(first.root), 'right', second.root.id), 'no-target');
    assert.equal(subject.get().paneLayouts.local.first, original);
    assert.equal(subject.calls.scheduled + subject.calls.copies.length, 0);
    assert.equal(subject.get().dockInSplit('local', request, 'right'), 'opened');
    const current = subject.get().paneLayouts.local.first;
    assert.equal(current.root.children[0], first.root);
    assert.equal(layout.collectLeaves(current.root.children[1]).length, 2);
});

test('all-hidden split/dock/feature operations do not create implicit replacements', () => {
    const files = layout.singleFeaturePane('files', 'files-pane', 'files-one');
    const subject = harness({ 'files-one': files });
    hideContent(subject, files.root);
    const before = subject.get();
    assert.equal(subject.get().splitPanes('local'), false);
    assert.equal(subject.get().splitFeaturePane('local', 'files', 'horizontal', 'files-one'), 'no-target');
    assert.equal(subject.get().dockInSplit('local', { kind: 'plugin', pluginId: 'owner:panel' }, 'right'), 'no-target');
    assert.equal(subject.get(), before);
    assert.equal(subject.calls.copies.length + subject.calls.scheduled + subject.calls.killed.length + subject.calls.destroyed.length, 0);
});

test('hidden feature and synthetic overlay targets cannot create replacement instances beside visible content', () => {
    for (const legacy of [false, true]) {
        const files = layout.singleFeaturePane('files', 'files-pane', 'files-one');
        if (legacy) files.root.content = { kind: 'feature', featureId: 'files' };
        const other = plugin('other');
        const subject = harness({ files: files, other });
        hideContent(subject, files.root);
        const before = subject.get();
        assert.equal(subject.get().splitFeaturePane('local', 'files', 'horizontal', legacy ? undefined : 'files-one'), 'no-target');
        assert.equal(subject.get().splitFeaturePane('local', 'files'), 'no-target');
        assert.equal(subject.get().dockInSplit('local', { kind: 'feature', featureId: 'dashboard' }, 'right', 'overlay:files', undefined, files.root.content), 'no-target');
        assert.equal(subject.get(), before);
        assert.equal(subject.calls.copies.length + subject.calls.scheduled, 0);
    }
});

test('explicit standalone shell targets remain usable but hidden shells cannot be targeted', () => {
    const incoming = plugin('incoming');
    for (const hidden of [false, true]) {
        const subject = harness({ incoming });
        subject.set({ terminals: { local: [{ id: 'shell', title: 'Shell' }] }, activeTerminalIds: { local: 'shell' } });
        if (hidden) hideContent(subject, layout.singlePane('shell', 'shell').root);
        const before = subject.get();
        const result = subject.get().dockInSplit('local', layout.paneDockPayload(incoming.root), 'right', 'shell');
        assert.equal(result, hidden ? 'no-target' : 'moved');
        if (hidden) assert.equal(subject.get(), before);
        else {
            const leaves = layout.collectLeaves(subject.get().paneLayouts.local.shell.root);
            assert.equal(leaves.length, 2);
            assert.ok(leaves.some(pane => pane.id === 'shell' && pane.content.termId === 'shell'));
        }
    }
});

test('background ensure reuses hidden and split-only terminal inventory without creating or selecting replacements', () => {
    const shell = layout.singlePane('shell', 'shell-pane');
    const subject = harness({ shell });
    subject.set({ terminals: { local: [{ id: 'shell', title: 'Shell', tabVisible: false }] }, activeTerminalIds: { local: null } });
    hideContent(subject, shell.root);
    const before = subject.get();
    assert.equal(subject.get().ensureTerminal('local'), 'shell');
    assert.equal(subject.get(), before);
    assert.equal(subject.calls.scheduled, 0);
    subject.set({ contentPresentation: {} });
    assert.equal(subject.get().ensureTerminal('local'), 'shell');
    assert.equal(subject.get().terminals.local.length, 1);
    assert.equal(subject.get().activeTerminalIds.local, 'shell');
});

test('production explicit-shell split menu refuses hidden-only content before creation, docking or view changes', () => {
    const first = plugin('first');
    const subject = harness({ first });
    hideContent(subject, first.root);
    const calls = [];
    subject.set({ createTerminal: (...args) => { calls.push(['create', ...args]); return 'unexpected'; },
        dockInSplit: (...args) => { calls.push(['dock', ...args]); return 'opened'; },
        setTabView: (...args) => calls.push(['view', ...args]),
    });
    const callbacks = tabBarCallbacks(subject);
    assert.equal(callbacks.canSplit, false);
    callbacks.onSplitNewShell('right', { id: 'bash', label: 'Bash' });
    assert.deepEqual(calls, []);
    assert.equal(subject.get().paneLayouts.local.first, first);
});

test('production explicit-shell split menu targets the visible leaf and preserves hidden siblings', () => {
    const first = plugin('first');
    const second = plugin('second');
    const original = { ...split(first, second), activePaneId: first.root.id };
    const subject = harness({ first: original });
    hideContent(subject, first.root);
    const calls = [];
    const splitAction = subject.get().splitPanes;
    subject.set({ createTerminal: () => assert.fail('split cannot publish a temporary standalone shell'),
        dockInSplit: () => assert.fail('split cannot move an already published temporary shell'),
        splitPanes: (...args) => { calls.push(['split', ...args]); return splitAction(...args); },
        setTabView: (...args) => calls.push(['view', ...args]),
    });
    const callbacks = tabBarCallbacks(subject);
    assert.equal(callbacks.canSplit, true);
    callbacks.onSplitNewShell('right', { id: 'bash', label: 'Bash' });
    assert.equal(calls[0][0], 'split');
    assert.equal(calls[0][4].contentId, key(second.root));
    assert.equal(calls[0][5].shellOverride, 'bash');
    assert.deepEqual(calls[1], ['view', 'main', 'terminal']);
    const current = subject.get().paneLayouts.local.first;
    assert.equal(current.root.children[0], first.root);
    assert.equal(layout.collectLeaves(current.root.children[1]).length, 2);
    assert.equal(subject.get().terminals.local.length, 1);
    assert.equal(subject.calls.scheduled, 1);
    assert.equal(subject.calls.forgotten.length + subject.calls.killed.length + subject.calls.destroyed.length, 0);
});

test('production Split duplicates the focused dock without changing the selected center canvas', () => {
    for (const centerKind of ['files', 'plugin']) {
        const center = centerKind === 'files' ? layout.singleFeaturePane('files', 'files-pane', 'files-one') : plugin('center');
        const subject = harness({ center });
        const views = [];
        const shellKey = key(layout.singlePane('shell', 'shell').root);
        subject.set({ sessionLoaded: true, terminals: { local: [{ id: 'shell', title: 'Shell' }] },
            activeTerminalIds: { local: 'shell' }, activePaneGroupOwner: { local: 'center' },
            workspaceDocking: { local: { version: 1, placements: { [shellKey]: 'secondary-sidebar' } } },
            workspaceDockFocus: { local: shellKey }, setTabView: (...args) => views.push(args) });
        const callbacks = tabBarCallbacks(subject, centerKind === 'files' ? {
            activeView: 'files', featureTabs: [{ id: 'files-one', featureId: 'files', instanceId: 'files-one' }], activeFeatureTabId: 'files-one',
        } : {});
        assert.equal(callbacks.canSplit, true);
        callbacks.onSplit('horizontal');
        assert.equal(subject.get().paneLayouts.local.center, center);
        assert.equal(subject.get().terminals.local.length, 2);
        assert.equal(subject.get().activePaneGroupOwner.local, 'center');
        assert.deepEqual(views, []);
        assert.equal(subject.calls.copies.length, 0);
    }
});

test('explicit hidden close still honors guards and only disposes metadata after actual removal', () => {
    const first = plugin('first');
    for (const blocked of [true, false]) {
        const subject = harness({ first }, { blocked });
        hideContent(subject, first.root);
        assert.equal(subject.get().closePaneInSplit('local', first.root.id), !blocked);
        if (blocked) {
            assert.equal(subject.get().paneLayouts.local.first, first);
            assert.equal(subject.get().contentPresentation.local.items[key(first.root)].hidden, true);
            assert.equal(subject.calls.forgotten.length, 0);
        } else {
            assert.equal(inventory.findWorkspaceContentPane(subject.get().paneLayouts.local, key(first.root)), undefined);
            assert.equal(subject.get().contentPresentation.local.items[key(first.root)], undefined);
        }
    }
});

test('plugin view resolution prefers the selected instance canvas, never an unrelated first sibling', () => {
    const first = plugin('first');
    const second = plugin('second');
    assert.equal(groups.layoutForPlugin({ first, second }, 'owner:panel', 'second'), second);
    assert.equal(groups.layoutForPlugin({ first, second }, 'owner:panel', 'stale'), first);
});

test('releasing the owner pane atomically preserves both plugin identities and promotes the remainder', () => {
    const first = plugin('first');
    const second = plugin('second');
    const mixed = split(first, second);
    const released = groups.releasePaneFromGroups({ first: mixed }, first.root.id);
    assert.equal(released.groups.first.root, first.root);
    assert.equal(released.groups.second.root.content.instanceId, 'second');
    assert.equal(released.releasedOwner, 'first');
    assert.equal(inventory.deriveWorkspaceContentInventory([], released.groups).length, 2);
    assert.equal(groups.releasePaneFromGroups(released.groups, first.root.id), undefined);
});

test('generic split duplicates a permitted plugin with a fresh instance, without disposing the original', () => {
    const original = plugin('first');
    const subject = harness({ first: original });
    subject.get().splitPanes('local');
    const leaves = layout.collectLeaves(subject.get().paneLayouts.local.first.root);
    assert.equal(leaves.length, 2);
    assert.equal(leaves[0].content.instanceId, 'first');
    assert.notEqual(leaves[1].content.instanceId, 'first');
    assert.notEqual(key(leaves[0]), key(leaves[1]));
    assert.equal(subject.calls.killed.length + subject.calls.destroyed.length + subject.calls.forgotten.length, 0);
});

test('single-instance registration refuses both generic and self-dock clones without mutations', () => {
    const original = plugin('first');
    const subject = harness({ first: original }, { multiple: false });
    subject.get().splitPanes('local');
    assert.equal(subject.get().paneLayouts.local.first, original);
    assert.equal(subject.get().dockInSplit('local', layout.paneDockPayload(original.root), 'right', original.root.id), 'no-target');
    assert.equal(subject.get().paneLayouts.local.first, original);
    assert.equal(subject.calls.warnings.length, 2);
    assert.equal(subject.calls.killed.length + subject.calls.destroyed.length + subject.calls.forgotten.length, 0);
});

test('moving a single-instance plugin into another canvas is allowed and preserves its key', () => {
    const original = plugin('first');
    const target = layout.singleFeaturePane('dashboard', 'dashboard-pane', 'dashboard');
    const subject = harness({ first: original, dashboard: target }, { multiple: false });
    const moved = subject.get().dockInSplit('local', layout.paneDockPayload(original.root), 'right', target.root.id);
    assert.equal(moved, 'moved');
    const current = inventory.findWorkspaceContentPane(subject.get().paneLayouts.local, key(original.root));
    assert.equal(current.owner, 'dashboard');
    assert.equal(current.pane.content, original.root.content);
    assert.equal(subject.calls.forgotten.length + subject.calls.warnings.length, 0);
});

test('closing any standalone shell preserves unrelated canvases, resources and metadata', () => {
    for (const closed of ['shell-one', 'shell-two', 'shell-three']) {
        for (const explicitCanvas of [false, true]) {
            const files = layout.singleFeaturePane('files', 'files-pane', 'files-one');
            const dashboard = layout.singleFeaturePane('dashboard', 'dashboard-pane', 'dashboard-one');
            const frame = plugin('plugin-one');
            const mixed = split(plugin('plugin-two'), layout.singleFeaturePane('snippets', 'snippets-pane', 'snippets-one'));
            const owned = layout.singlePane(closed, `pane-${closed}`);
            const neighbors = { 'files-one': files, 'dashboard-one': dashboard, 'plugin-one': frame, 'plugin-two': mixed };
            const subject = harness({ ...neighbors, ...(explicitCanvas ? { [closed]: owned } : {}) });
            const foreign = { foreign: plugin('foreign') };
            const tabs = ['shell-one', 'shell-two', 'shell-three'].map(id => ({ id, tabVisible: true }));
            const metadataBefore = { ...subject.get().contentPresentation.local.items };
            const dockFocus = { region: 'right', paneId: frame.root.id };
            subject.set({ terminals: { local: tabs }, activeTerminalIds: { local: closed },
                paneLayouts: { local: subject.get().paneLayouts.local, other: foreign },
                activePaneGroupOwner: { local: 'plugin-two' }, workspaceDockFocus: { local: dockFocus },
                aiConversations: Object.fromEntries(tabs.map(tab => [tab.id, { messages: [tab.id] }])),
                aiDisplayHistory: Object.fromEntries(tabs.map(tab => [tab.id, [tab.id]])),
            });
            subject.get().closeTerminalGroup('local', closed);
            assert.deepEqual(Object.keys(subject.get().paneLayouts.local), Object.keys(neighbors));
            for (const [owner, canvas] of Object.entries(neighbors)) assert.equal(subject.get().paneLayouts.local[owner], canvas);
            assert.equal(subject.get().paneLayouts.other, foreign);
            assert.equal(subject.get().workspaceDockFocus.local, dockFocus);
            assert.equal(subject.get().activePaneGroupOwner.local, 'plugin-two');
            assert.deepEqual(Array.from(subject.get().terminals.local, tab => tab.id), tabs.filter(tab => tab.id !== closed).map(tab => tab.id));
            assert.deepEqual(subject.calls.destroyed, [closed]);
            assert.deepEqual(subject.calls.killed.map(([, args]) => args.termId), [closed]);
            for (const pane of [files.root, dashboard.root, frame.root, ...layout.collectLeaves(mixed.root)]) {
                assert.equal(subject.get().contentPresentation.local.items[key(pane)], metadataBefore[key(pane)]);
                assert.ok(!subject.calls.forgotten.includes(key(pane)));
            }
            assert.equal(subject.get().aiConversations[closed], undefined);
            assert.equal(subject.get().aiDisplayHistory[closed], undefined);
            for (const tab of tabs.filter(tab => tab.id !== closed)) {
                assert.deepEqual(subject.get().aiConversations[tab.id].messages, [tab.id]);
                assert.deepEqual(subject.get().aiDisplayHistory[tab.id], [tab.id]);
            }
        }
    }
});

test('closing a shell group removes its members only and leaves unrelated single-pane tabs intact', () => {
    const shell = layout.singlePane('shell-two', 'shell-two-pane');
    const sibling = layout.singlePane('shell-child', 'shell-child-pane');
    const grouped = split(split(shell, sibling), layout.singleFeaturePane('files', 'group-files-pane', 'group-files'));
    const neighbor = plugin('neighbor');
    const files = layout.singleFeaturePane('files', 'other-files-pane', 'other-files');
    const subject = harness({ 'shell-two': grouped, neighbor, 'other-files': files });
    subject.set({ terminals: { local: ['shell-one', 'shell-two', 'shell-child', 'shell-three'].map(id => ({ id, tabVisible: id !== 'shell-child' })) },
        activeTerminalIds: { local: 'shell-child' } });
    subject.get().closeTerminalGroup('local', 'shell-child');
    assert.deepEqual(Object.keys(subject.get().paneLayouts.local), ['neighbor', 'other-files']);
    assert.equal(subject.get().paneLayouts.local.neighbor, neighbor);
    assert.equal(subject.get().paneLayouts.local['other-files'], files);
    assert.deepEqual(Array.from(subject.get().terminals.local, tab => tab.id), ['shell-one', 'shell-three']);
    assert.deepEqual(subject.calls.destroyed, ['shell-two', 'shell-child']);
    assert.deepEqual([...subject.calls.forgotten].sort(), layout.collectLeaves(grouped.root).map(key).sort());
    assert.ok(subject.get().contentPresentation.local.items[key(neighbor.root)]);
    assert.ok(subject.get().contentPresentation.local.items[key(files.root)]);
});

test('unsplit preserves alias and content; closing one sibling forgets only that exact identity', () => {
    const first = plugin('first');
    const second = plugin('second');
    const subject = harness({ first: split(first, second) });
    assert.equal(subject.get().releasePaneFromSplit('local', second.root.id), true);
    assert.equal(subject.get().paneLayouts.local.second.root.content.instanceId, 'second');
    assert.equal(subject.get().contentPresentation.local.items[key(second.root)].displayAlias, `Alias ${key(second.root)}`);
    assert.equal(subject.calls.forgotten.length, 0);
    assert.equal(subject.get().closePaneGroup('local', 'second'), true);
    assert.equal(subject.get().paneLayouts.local.first.root.content.instanceId, 'first');
    assert.equal(subject.calls.forgotten.length, 1);
    assert.equal(subject.calls.forgotten[0], key(second.root));
    assert.ok(subject.get().contentPresentation.local.items[key(first.root)]);
    assert.equal(subject.calls.killed.length + subject.calls.destroyed.length, 0);
});

test('blocked close and stale pane requests do not forget aliases or detach content', () => {
    const first = plugin('first');
    const second = plugin('second');
    const mixed = split(first, second);
    const subject = harness({ first: mixed }, { blocked: true });
    assert.equal(subject.get().closePaneInSplit('local', second.root.id), false);
    assert.equal(subject.get().closePaneGroup('local', 'first'), false);
    assert.equal(subject.get().releasePaneFromSplit('local', 'stale'), false);
    assert.equal(subject.get().paneLayouts.local.first, mixed);
    assert.equal(subject.calls.forgotten.length, 0);
});

test('implicit focused self-dock enforces multiplicity and allocates a distinct permitted instance', () => {
    for (const multiple of [false, true]) {
        const original = plugin('first');
        const subject = harness({ first: original }, { multiple });
        const result = subject.get().dockInSplit('local', { kind: 'plugin', pluginId: 'owner:panel', instanceId: 'first' }, 'right');
        const leaves = layout.collectLeaves(subject.get().paneLayouts.local.first.root);
        assert.equal(result, multiple ? 'opened' : 'no-target');
        assert.equal(leaves.length, multiple ? 2 : 1);
        assert.equal(new Set(leaves.map(key)).size, leaves.length);
        assert.equal(subject.calls.warnings.length, multiple ? 0 : 1);
        if (!multiple) assert.equal(subject.get().paneLayouts.local.first, original);
    }
});

test('implicit target moves a single-instance plugin to the focused other canvas or standalone shell', () => {
    for (const targetIsShell of [false, true]) {
        const original = plugin('first');
        const target = layout.singleFeaturePane('dashboard', 'dashboard-pane', 'dashboard');
        const subject = harness(targetIsShell ? { first: original } : { first: original, dashboard: target }, { multiple: false });
        subject.set(targetIsShell
            ? { terminals: { local: [{ id: 'shell', title: 'Shell' }] }, activeTerminalIds: { local: 'shell' }, activePaneGroupOwner: { local: null } }
            : { activePaneGroupOwner: { local: 'dashboard' } });
        assert.equal(subject.get().dockInSplit('local', layout.paneDockPayload(original.root), 'right'), 'moved');
        const current = inventory.findWorkspaceContentPane(subject.get().paneLayouts.local, key(original.root));
        assert.equal(current.owner, targetIsShell ? 'shell' : 'dashboard');
        assert.equal(current.pane.content, original.root.content);
        assert.equal(inventory.deriveWorkspaceContentInventory([], subject.get().paneLayouts.local).filter(item => item.content.kind === 'plugin').length, 1);
        assert.equal(subject.calls.warnings.length + subject.calls.forgotten.length, 0);
    }
});

test('implicit standalone-shell target reuses one seeded leaf when opening brand-new content', () => {
    for (const content of [{ kind: 'plugin', pluginId: 'owner:panel' }, { kind: 'feature', featureId: 'dashboard' }, { kind: 'term', termId: 'other-shell' }]) {
        const subject = harness({}, { multiple: false });
        subject.set({ terminals: { local: [{ id: 'shell', title: 'Shell' }, { id: 'other-shell', title: 'Other' }] },
            activeTerminalIds: { local: 'shell' }, activePaneGroupOwner: { local: null } });
        assert.ok(['opened', 'moved'].includes(subject.get().dockInSplit('local', content, 'right')));
        const leaves = layout.collectLeaves(subject.get().paneLayouts.local.shell.root);
        assert.equal(leaves.length, 2);
        assert.equal(leaves[0].content.termId, 'shell');
        assert.equal(leaves[1].content.kind, content.kind);
        assert.equal(subject.calls.warnings.length, 0);
    }
});

test('legacy feature and plugin releases round-trip stable pane keys and aliases without allocating identity', () => {
    for (const pluginKind of [false, true]) {
        const first = layout.singleFeaturePane('files', 'old-a');
        const second = layout.singleFeaturePane('dashboard', 'old-b');
        if (pluginKind) {
            first.root.content = { kind: 'plugin', pluginId: 'owner:panel' };
            second.root.content = { kind: 'plugin', pluginId: 'owner:panel' };
        }
        const originalKeys = [key(first.root), key(second.root)].sort();
        const aliases = Object.fromEntries(originalKeys.map(id => [id, `Alias ${id}`]));
        const released = groups.releasePaneFromGroups({ workspace: split(first, second) }, first.root.id);
        assert.ok(released);
        assert.equal(released.released, first.root);
        const snapshot = groups.snapshotPaneLayoutGroups({ local: released.groups }, { local: [] });
        assert.equal(Object.keys(snapshot.local).length, 2);
        const restored = groups.parsePaneLayoutGroups(JSON.parse(JSON.stringify(snapshot.local)), new Set());
        for (const [owner, canvas] of Object.entries(restored)) assert.equal(groups.ownerForLayout(canvas, owner), owner);
        const items = inventory.deriveWorkspaceContentInventory([], restored);
        assert.deepEqual(Array.from(items, item => item.id).sort(), originalKeys);
        assert.ok(items.every(item => item.content.instanceId === undefined && aliases[item.id] === `Alias ${item.id}`));
        if (pluginKind) {
            const oldOwner = groups.parsePaneLayoutGroups({ 'owner:panel': first }, new Set());
            assert.equal(key(oldOwner['owner:panel'].root), key(first.root));
        }
    }
});

test('dirty editor release moves the same content without invoking close blockers or resource disposal', () => {
    const files = layout.singleFeaturePane('files', 'files-pane', 'files-one');
    const dashboard = layout.singleFeaturePane('dashboard', 'dashboard-pane', 'dashboard-one');
    const subject = harness({ 'files-one': split(files, dashboard) }, { blocked: true });
    assert.equal(subject.get().releasePaneFromSplit('local', files.root.id), true);
    assert.equal(subject.get().paneLayouts.local['files-one'].root, files.root);
    assert.equal(subject.calls.closeChecks, 0);
    assert.equal(subject.calls.killed.length + subject.calls.destroyed.length + subject.calls.forgotten.length, 0);
    assert.equal(subject.get().closePaneGroup('local', 'files-one'), false);
    assert.equal(subject.calls.closeChecks, 1);
});

test('production tab adapter changes selected view only after a successful split', () => {
    for (const refusal of ['multiplicity', 'cap', 'none']) {
        let original = plugin('first');
        if (refusal === 'cap') {
            for (const id of ['second', 'third', 'fourth']) original = split(original, plugin(id));
        }
        const subject = harness({ first: original }, { multiple: refusal !== 'multiplicity' });
        const transitions = [];
        subject.set({ setTabView: (...args) => {
            assert.ok(layout.collectLeaves(subject.get().paneLayouts.local.first.root).length > 1, 'view switch follows successful split');
            transitions.push(args);
        } });
        tabBarCallbacks(subject).onSplitNewShell('right');
        assert.equal(transitions.length, refusal === 'none' ? 1 : 0);
        if (refusal !== 'none') assert.equal(subject.get().paneLayouts.local.first, original);
    }
});

test('closing the selected plugin view falls back to terminal when its last instance closes', () => {
    const first = plugin('first');
    const subject = harness({ first });
    const callback = pluginTabClose(subject, 'plugin:owner:panel');
    callback.close(key(first.root));
    assert.deepEqual(callback.effects.views, [['main', 'terminal']]);
    assert.deepEqual(callback.effects.selected, []);
    assert.equal(inventory.findWorkspaceContentPane(subject.get().paneLayouts.local, key(first.root)), undefined);
});

test('closing a plugin preserves terminal and feature views even when its owner is selected', () => {
    for (const view of ['terminal', 'files', 'dashboard', 'plugin:another:panel']) {
        const first = plugin('first');
        const subject = harness({ first });
        const callback = pluginTabClose(subject, view);
        callback.close(key(first.root));
        assert.equal(callback.effects.views.length + callback.effects.selected.length, 0, view);
        assert.equal(inventory.findWorkspaceContentPane(subject.get().paneLayouts.local, key(first.root)), undefined);
    }
});

test('closing a same-panel instance in another owner does not change the selected plugin view', () => {
    const first = plugin('first');
    const second = plugin('second');
    const subject = harness({ first, second });
    subject.set({ activePaneGroupOwner: { local: 'second' } });
    const callback = pluginTabClose(subject, 'plugin:owner:panel');
    callback.close(key(first.root));
    assert.equal(callback.effects.views.length + callback.effects.selected.length, 0);
    assert.equal(subject.get().paneLayouts.local.second, second);
});

test('a blocked plugin tab close has no selection, pin or inventory effects', () => {
    const first = plugin('first');
    const subject = harness({ first }, { blocked: true });
    const callback = pluginTabClose(subject, 'plugin:owner:panel', ['plugin:owner:panel']);
    callback.close(key(first.root));
    assert.equal(callback.effects.views.length + callback.effects.selected.length + callback.effects.toggles.length, 0);
    assert.equal(subject.get().paneLayouts.local.first, first);
    assert.equal(subject.calls.forgotten.length, 0);
});

test('closing the selected plugin instance selects its exact surviving sibling before other plugin kinds', () => {
    const first = plugin('first');
    const second = plugin('second');
    const other = layout.singlePluginPane('another:panel', 'other-pane', 'other');
    const subject = harness({ first, other, second });
    const callback = pluginTabClose(subject, 'plugin:owner:panel', ['plugin:owner:panel']);
    callback.close(key(first.root));
    assert.deepEqual(callback.effects.selected, [key(second.root)]);
    assert.equal(callback.effects.views.length + callback.effects.toggles.length, 0);
});
