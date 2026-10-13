import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function loadSource(path, dependencies = {}) {
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../src/${path}.ts`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const context = { exports: {}, require: name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    } };
    runInNewContext(outputText, context);
    return context.exports;
}
const types = loadSource('lib/paneLayout/types');
const query = loadSource('lib/paneLayout/query', { './types': types });
const identity = loadSource('lib/paneLayout/contentIdentity');
const ops = loadSource('lib/paneLayout/ops', { './ids': {}, './query': query, './dock': {}, './intro': {}, './types': types });
const groups = loadSource('lib/paneLayout/groups', { './persist': {}, './ops': ops, './query': query, './contentIdentity': identity });
const projection = loadSource('lib/paneLayout/visibility', { './contentIdentity': identity, './query': query });
const layout = { ...types, ...query, ...ops, ...groups, ...identity, ...projection };
const inventory = loadSource('features/workspace/domain/contentInventory', {
    '../../../lib/paneLayout/contentIdentity': identity, '../../../lib/paneLayout/query': query,
});
const titles = loadSource('features/workspace/domain/presentation');
const metadata = loadSource('features/workspace/domain/contentPresentation', { './presentation': titles });
const visible = loadSource('features/workspace/domain/visibleContent', {
    '../../../lib/paneLayout': layout, './contentInventory': inventory, './contentPresentation': metadata,
});
const selection = loadSource('features/workspace/application/selectExistingContent', {
    '../../../lib/paneLayout': layout, '../domain/contentInventory': inventory, '../domain/visibleContent': visible,
});
const tabs = loadSource('features/workspace/domain/tabPresentation', { './contentPresentation': metadata });

const leaf = (id, content) => ({ type: 'pane', id, content });
const shell = leaf('shell-pane', { kind: 'term', termId: 'shell' });
const files = leaf('files-pane', { kind: 'feature', featureId: 'files', instanceId: 'files-one' });
const plugin = leaf('plugin-pane', { kind: 'plugin', pluginId: 'owner:panel', instanceId: 'plugin-one' });
const sibling = leaf('sibling-pane', { kind: 'plugin', pluginId: 'owner:panel', instanceId: 'plugin-two' });
const single = pane => ({ version: 1, root: pane, activePaneId: pane.id });
const split = (first, second, activePaneId = first.id) => ({ version: 1, activePaneId,
    root: { type: 'split', id: `split-${first.id}`, direction: 'horizontal', sizes: [0.5, 0.5], children: [first, second] } });
const key = pane => identity.paneContentKey(pane.content, pane.id);
function subject(paneGroups = {}, terminals = [{ id: 'shell', title: 'Shell' }]) {
    const calls = { focus: [], terminal: [], instances: [], views: [], close: [], input: [] };
    const state = {
        terminals: { local: terminals }, paneLayouts: { local: paneGroups }, activeTerminalIds: { local: terminals[0]?.id ?? null },
        activePaneGroupOwner: { local: null }, contentPresentation: {}, activeConnectionId: 'local',
        focusPane: (...args) => calls.focus.push(args), setActiveTerminal: (...args) => calls.terminal.push(args),
        closeTerminalGroup: (...args) => calls.close.push(args),
        ensureFeaturePane: () => assert.fail('selection cannot ensure content'),
        ensurePluginPane: () => assert.fail('selection cannot ensure content'),
        createTerminal: () => assert.fail('selection cannot create terminals'),
    };
    const select = id => selection.selectExistingWorkspaceContent(state, 'local', id,
        id => calls.instances.push(id), view => calls.views.push(view));
    return { state, calls, select };
}
function hide(state, ...panes) {
    state.contentPresentation.local = { version: 3, items: Object.fromEntries(panes.map(pane => [key(pane), { hidden: true }])) };
}

test('canvas resolver shares exact modern and preferred legacy-kind precedence', () => {
    const legacy = leaf('legacy-files', { kind: 'feature', featureId: 'files' });
    const otherLegacy = leaf('other-legacy-files', { kind: 'feature', featureId: 'files' });
    const paneGroups = { files: single(files), legacy: single(legacy), otherLegacy: single(otherLegacy),
        plugin: single(plugin), sibling: single(sibling), shell: split(shell, files) };
    assert.equal(visible.resolveWorkspaceCanvas(paneGroups, 'shell', 'sibling', undefined, 'owner:panel'), paneGroups.sibling);
    assert.equal(visible.resolveWorkspaceCanvas(paneGroups, 'shell', 'shell', 'files-one'), paneGroups.files);
    assert.equal(visible.resolveWorkspaceCanvas(paneGroups, 'shell', 'otherLegacy', undefined, undefined, 'files'), paneGroups.otherLegacy);
    assert.equal(visible.resolveWorkspaceCanvas({ legacy: paneGroups.legacy }, null, null, undefined, undefined, 'files'), paneGroups.legacy);
    assert.equal(visible.resolveWorkspaceCanvas(paneGroups, 'shell', 'plugin'), paneGroups.plugin);
    assert.equal(visible.resolveWorkspaceCanvas(paneGroups, 'shell', 'plugin', undefined, 'missing:panel'), undefined);
});

test('selected identity comes from canonical focused content or a live standalone shell', () => {
    const data = subject({ plugin: split(plugin, files, files.id) });
    data.state.activePaneGroupOwner.local = 'plugin';
    assert.equal(visible.selectedWorkspaceContentId(data.state, 'local'), key(files));
    data.state.activePaneGroupOwner.local = null;
    data.state.paneLayouts.local = {};
    assert.equal(visible.selectedWorkspaceContentId(data.state, 'local'), key(shell));
    assert.equal(visible.selectedWorkspaceContentId(data.state, 'local', undefined, 'missing:panel'), null);
    assert.equal(visible.selectedWorkspaceContentId(data.state, 'local', undefined, undefined, 'files'), null,
        'an unresolved selected feature must not silently select the historical shell');
    data.state.terminals.local = [];
    assert.equal(visible.selectedWorkspaceContentId(data.state, 'local'), null);
});

test('hidden runtime inventory contains only fresh live identities, not dormant preferences', () => {
    const data = subject({ plugin: single(plugin) });
    hide(data.state, plugin, files);
    assert.deepEqual(Array.from(visible.hiddenWorkspaceContent(data.state, 'local')), [key(plugin)]);
    assert.equal(Object.keys(data.state.paneLayouts.local).length, 1);
});

test('fallback keeps visible selection, then prefers a canvas sibling before global pinned/order ranks', () => {
    const data = subject({ grouped: split(plugin, files), sibling: single(sibling) });
    data.state.contentPresentation.local = { version: 3, items: { [key(sibling)]: { pinned: true } }, order: [key(sibling), key(shell), key(files)] };
    assert.equal(visible.visibleContentFallback(data.state, 'local', key(plugin)).id, key(plugin));
    data.state.contentPresentation.local.items[key(plugin)] = { hidden: true };
    assert.equal(visible.visibleContentFallback(data.state, 'local', key(plugin)).id, key(files));
    data.state.contentPresentation.local.items[key(files)] = { hidden: true };
    assert.equal(visible.visibleContentFallback(data.state, 'local', key(plugin)).id, key(sibling));
    assert.equal(visible.visibleContentFallback(data.state, 'local', 'stale').id, key(sibling));
});

test('all-hidden fallback is absent and cannot create a replacement resource', () => {
    const data = subject({ group: split(files, plugin) });
    hide(data.state, shell, files, plugin);
    assert.equal(visible.visibleContentFallback(data.state, 'local', key(files)), undefined);
    assert.equal(visible.visibleContentFallback(data.state, 'local', null), undefined);
    assert.equal(data.calls.focus.length + data.calls.terminal.length, 0);
});

test('existing selection routes modern feature/plugin/standalone and grouped shell without open capabilities', () => {
    for (const pane of [files, plugin, shell]) {
        const data = subject({ selected: pane === shell ? split(shell, files) : single(pane) });
        const before = JSON.stringify(data.state.paneLayouts);
        assert.equal(data.select(key(pane)), true);
        assert.deepEqual(data.calls.focus, [['local', pane.id]]);
        assert.deepEqual(data.calls.terminal, []);
        assert.equal(data.calls.views[0], pane === files ? 'files' : pane === plugin ? 'plugin:owner:panel' : 'terminal');
        if (pane === files) assert.deepEqual(data.calls.instances, ['files-one']);
        assert.equal(JSON.stringify(data.state.paneLayouts), before);
    }
    const standalone = subject();
    assert.equal(standalone.select(key(shell)), true);
    assert.deepEqual(standalone.calls.terminal, [['local', 'shell']]);
    assert.deepEqual(standalone.calls.instances, [null]);
    assert.deepEqual(standalone.calls.views, ['terminal']);
});

test('legacy and moved instance selection uses the current exact leaf and never fabricates IDs', () => {
    for (const content of [{ kind: 'feature', featureId: 'files' }, { kind: 'plugin', pluginId: 'legacy:opaque:panel' }]) {
        const pane = leaf('persisted-leaf', content);
        const data = subject({ restored: single(pane) }, []);
        assert.equal(data.select(key(pane)), true);
        assert.deepEqual(data.calls.focus, [['local', 'persisted-leaf']]);
        assert.equal(content.instanceId, undefined);
        assert.equal(data.state.paneLayouts.local.restored.root, pane);
        assert.equal(data.calls.views[0], content.kind === 'feature' ? 'terminal' : 'plugin:legacy:opaque:panel');
    }
    const data = subject({ original: single(plugin) });
    const moved = { ...plugin, id: 'fresh-allocation-leaf' };
    data.state.paneLayouts.local = { moved: single(moved) };
    assert.equal(data.select(key(plugin)), true);
    assert.deepEqual(data.calls.focus, [['local', moved.id]]);
});

test('hidden or stale selection refuses before any focus, view or instance callbacks', () => {
    const data = subject({ plugin: single(plugin) });
    hide(data.state, plugin);
    assert.equal(data.select(key(plugin)), false);
    assert.equal(data.select(key(files)), false);
    assert.equal(data.select('stale'), false);
    assert.ok(Object.values(data.calls).every(calls => calls.length === 0));
});

test('tab projection omits hidden instances and ranks each split by visible members only', () => {
    const descriptors = [{ id: 'shell', contentIds: [key(shell)] }, { id: 'group', contentIds: [key(plugin), key(files)] },
        { id: 'sibling', contentIds: [key(sibling)] }];
    const scope = { version: 3, items: { [key(plugin)]: { pinned: true, hidden: true } }, order: [key(sibling), key(plugin), key(shell), key(files)] };
    const projected = tabs.projectWorkspaceTabs(descriptors, scope);
    assert.deepEqual(Array.from(projected, item => item.item.id), ['sibling', 'shell', 'group']);
    assert.equal(projected.find(item => item.item.id === 'group').pinned, false, 'hidden pins cannot rank the visible group');
    scope.items[key(files)] = { hidden: true };
    assert.deepEqual(Array.from(tabs.projectWorkspaceTabs(descriptors, scope), item => item.item.id), ['sibling', 'shell']);
    scope.items[key(shell)] = { hidden: true };
    scope.items[key(sibling)] = { hidden: true };
    assert.equal(tabs.projectWorkspaceTabs(descriptors, scope).length, 0);
    delete scope.items[key(plugin)].hidden;
    assert.equal(tabs.projectWorkspaceTabs(descriptors, scope)[0].item, descriptors[1]);
});

test('implicit input retains the historical shell target but refuses hidden, closed and absent targets', () => {
    const data = subject({ files: single(files) });
    data.state.activePaneGroupOwner.local = 'files';
    assert.equal(visible.implicitTerminalTarget(data.state, 'local'), 'shell');
    data.state.terminals.local[0].tabVisible = false;
    assert.equal(visible.implicitTerminalTarget(data.state, 'local'), 'shell', 'split membership is not user hiding');
    hide(data.state, shell);
    assert.equal(visible.implicitTerminalTarget(data.state, 'local'), null);
    data.state.contentPresentation = {};
    data.state.terminals.local = [];
    assert.equal(visible.implicitTerminalTarget(data.state, 'local'), null);
    assert.equal(visible.implicitTerminalTarget(data.state, 'missing'), null);
});

const managerSource = ts.createSourceFile('TerminalManager.tsx', readFileSync(new URL('../src/components/terminal/TerminalManager.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let eventEffect;
function findEventEffect(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect'
        && node.arguments[0]?.getText(managerSource).includes('const handleRunCommand')) eventEffect = node.arguments[0].getText(managerSource);
    ts.forEachChild(node, findEventEffect);
}
findEventEffect(managerSource);
assert.ok(eventEffect, 'production TerminalManager event-routing effect exists');
const eventScript = ts.transpileModule(`globalThis.install = ${eventEffect}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function eventHarness(data, scopes) {
    const listeners = new Map();
    const window = {
        addEventListener: (name, handler) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(handler); },
        removeEventListener: (name, handler) => listeners.get(name)?.delete(handler),
    };
    const cleanup = scopes.map(scope => {
        const context = { window, activeConnectionId: scope, useAppStore: { getState: () => data.state },
            implicitTerminalTarget: visible.implicitTerminalTarget, findLayoutOwner: groups.findLayoutOwner,
            pendingReadyRef: { current: {} }, createTerminal: () => assert.fail('routing checks cannot create terminals'),
            queueTerminalInput: (...args) => data.calls.input.push(args),
        };
        runInNewContext(eventScript, context);
        return context.install();
    });
    return { fire: (name, detail) => { for (const handler of listeners.get(name) ?? []) handler({ detail }); },
        cleanup: () => cleanup.forEach(dispose => dispose()), listeners };
}

test('production implicit event handlers re-read hidden/closed targets and preserve explicitly addressed scope', () => {
    const data = subject({ mixed: split(shell, files) });
    const events = eventHarness(data, ['local']);
    events.fire('ssh-ui:run-command', { connectionId: 'local', command: 'first' });
    assert.deepEqual(data.calls.input, [['shell', 'first']]);
    hide(data.state, shell);
    events.fire('ssh-ui:run-command', { connectionId: 'local', command: 'hidden' });
    events.fire('zync:terminal:send', { connectionId: 'local', text: 'hidden' });
    events.fire('ssh-ui:close-terminal-tab', { connectionId: 'local' });
    assert.equal(data.calls.input.length, 1);
    assert.equal(data.calls.close.length, 0);
    data.state.contentPresentation = {};
    events.fire('ssh-ui:close-terminal-tab', { connectionId: 'local' });
    assert.deepEqual(data.calls.close, [['local', 'mixed']]);
    data.state.terminals.local = [];
    events.fire('zync:terminal:send', { connectionId: 'local', text: 'closed' });
    assert.equal(data.calls.input.length, 1);
    events.cleanup();
    assert.ok([...events.listeners.values()].every(handlers => handlers.size === 0));
});

test('unaddressed plugin sends reach only the active workspace among retained managers', () => {
    const data = subject();
    data.state.terminals.remote = [{ id: 'remote-shell', title: 'Remote' }];
    data.state.activeTerminalIds.remote = 'remote-shell';
    const events = eventHarness(data, ['local', 'remote']);
    events.fire('zync:terminal:send', { text: 'active-local' });
    assert.deepEqual(data.calls.input, [['shell', 'active-local']]);
    events.fire('zync:terminal:send', { connectionId: 'remote', text: 'addressed-remote' });
    assert.deepEqual(data.calls.input[1], ['remote-shell', 'addressed-remote']);
    data.state.activeConnectionId = 'remote';
    events.fire('zync:terminal:send', { text: 'active-remote' });
    assert.deepEqual(data.calls.input[2], ['remote-shell', 'active-remote']);
    data.state.activeConnectionId = null;
    events.fire('zync:terminal:send', { text: 'no-active-workspace' });
    assert.equal(data.calls.input.length, 3);
    events.cleanup();
});

const mainSource = ts.createSourceFile('MainLayout.tsx', readFileSync(new URL('../src/components/layout/MainLayout.tsx', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function mainCallback(name, context) {
    const callbacks = [];
    function visit(node) {
        if (ts.isVariableDeclaration(node) && node.name.getText(mainSource) === name
            && node.initializer && ts.isCallExpression(node.initializer)) callbacks.push(node.initializer.arguments[0].getText(mainSource));
        ts.forEachChild(node, visit);
    }
    visit(mainSource);
    assert.equal(callbacks.length, 1, `exactly one production ${name} callback must exist`);
    const { outputText } = ts.transpileModule(`globalThis.callback = ${callbacks[0]}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } });
    runInNewContext(outputText, context);
    return context.callback;
}
function closeHarness(view, paneGroups, { blocked = false, activeFeatureTabId = 'files-one', pinnedFeatures = [] } = {}) {
    const data = subject(paneGroups);
    const effects = [];
    const featureTabs = inventory.deriveWorkspaceContentInventory([], paneGroups)
        .filter(item => layout.isFeatureContent(item.content))
        .map(item => ({ id: item.content.instanceId, instanceId: item.content.instanceId, featureId: item.content.featureId }));
    data.state.closePaneGroup = (scope, owner) => {
        effects.push(['close-group', scope, owner]);
        if (blocked) return false;
        const { [owner]: removed, ...remaining } = data.state.paneLayouts[scope];
        assert.ok(removed, 'the callback must close a current canonical group');
        data.state.paneLayouts[scope] = remaining;
        return true;
    };
    data.state.closePaneInSplit = (scope, paneId) => {
        effects.push(['close-pane', scope, paneId]);
        assert.equal(blocked, true, 'successful split mutation is covered by the store lifecycle suite');
        return false;
    };
    data.state.activatePaneGroup = (...args) => effects.push(['activate', ...args]);
    const context = {
        ...layout, tab: { id: 'main', connectionId: 'local', view }, featureTabs, activeFeatureTabId, pinnedFeatures,
        useAppStore: { getState: () => data.state },
        setActiveFeatureTabId: (...args) => effects.push(['feature-id', ...args]),
        setTabView: (...args) => effects.push(['view', ...args]),
        handleFeatureTabSelect: (...args) => effects.push(['feature-select', ...args]),
        handlePluginTabSelect: (...args) => effects.push(['plugin-select', ...args]),
        toggleConnectionFeature: (...args) => effects.push(['unpin', ...args]),
        deriveWorkspaceContentInventory: (terminals, currentGroups) => {
            effects.push(['inventory']);
            assert.equal(currentGroups, data.state.paneLayouts.local, 'post-close fallback must read fresh canonical groups');
            return inventory.deriveWorkspaceContentInventory(terminals, currentGroups);
        },
    };
    return { ...data, effects, context };
}

test('production feature close preserves unrelated selected views despite a remembered feature instance', () => {
    for (const view of ['terminal', 'dashboard', 'plugin:owner:panel']) {
        const data = closeHarness(view, { files: single(files) });
        mainCallback('handleFeatureTabClose', data.context)('files-one', 'files');
        assert.deepEqual(data.effects, [['close-group', 'local', 'files']], view);
        assert.equal(Object.keys(data.state.paneLayouts.local).length, 0);
    }
    const data = closeHarness('files', { files: single(files) }, { activeFeatureTabId: 'another-instance' });
    mainCallback('handleFeatureTabClose', data.context)('files-one', 'files');
    assert.deepEqual(data.effects, [['close-group', 'local', 'files']], 'closing a different instance cannot change selection');
});

test('production selected feature close chooses a survivor or shell only after a successful close', () => {
    const otherFiles = leaf('other-files-pane', { kind: 'feature', featureId: 'files', instanceId: 'files-two' });
    const withSibling = closeHarness('files', { files: single(files), other: single(otherFiles) });
    mainCallback('handleFeatureTabClose', withSibling.context)('files-one', 'files');
    assert.deepEqual(withSibling.effects, [['close-group', 'local', 'files'], ['feature-select', 'files-two', 'files']]);
    const last = closeHarness('files', { files: single(files) });
    mainCallback('handleFeatureTabClose', last.context)('files-one', 'files');
    assert.deepEqual(last.effects, [['close-group', 'local', 'files'], ['feature-id', null], ['view', 'main', 'terminal']]);
});

test('production feature close refusal stops all selection effects for both group and split guards', () => {
    for (const current of [single(files), split(files, plugin)]) {
        const data = closeHarness('files', { files: current }, { blocked: true });
        mainCallback('handleFeatureTabClose', data.context)('files-one', 'files');
        const expectedClose = layout.isSplitLayout(current) ? ['close-pane', 'local', files.id] : ['close-group', 'local', 'files'];
        assert.deepEqual(data.effects, [expectedClose]);
        assert.equal(data.state.paneLayouts.local.files, current);
    }
});

test('production group close refuses before inventory, pin cleanup and selection effects', () => {
    const current = split(files, plugin);
    const data = closeHarness('files', { closing: current, survivor: single(sibling) },
        { blocked: true, pinnedFeatures: ['plugin:owner:panel'] });
    mainCallback('handlePaneGroupClose', data.context)('closing');
    assert.deepEqual(data.effects, [['close-group', 'local', 'closing']]);
    assert.equal(data.state.paneLayouts.local.closing, current);
});

test('production group close derives fallback and final-instance pin cleanup from post-close canonical inventory', () => {
    const surviving = leaf('surviving-pane', { kind: 'plugin', pluginId: 'different:panel', instanceId: 'surviving-plugin' });
    const data = closeHarness('files', { closing: split(files, plugin), survivor: single(surviving) },
        { pinnedFeatures: ['plugin:owner:panel'] });
    mainCallback('handlePaneGroupClose', data.context)('closing');
    assert.deepEqual(data.effects, [['close-group', 'local', 'closing'], ['inventory'],
        ['unpin', 'local', 'plugin:owner:panel'], ['feature-id', null], ['plugin-select', key(surviving)]]);
    assert.deepEqual(Object.keys(data.state.paneLayouts.local), ['survivor']);
    assert.equal(data.state.paneLayouts.local.survivor.root, surviving);
});
