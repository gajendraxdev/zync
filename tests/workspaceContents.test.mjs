import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import { loadWorkspaceDomain as domain } from './helpers/loadWorkspaceDomain.mjs';

const ContextMenu = () => null;
const DisplayAliasDialog = () => null;
const context = React.createContext(null);
const key = id => domain('lib/paneLayout/contentIdentity.ts').paneContentKey({ kind: 'term', termId: id }, id);
const first = key('first'), second = key('second');

/** Test the connected production adapter with native storage and portal I/O isolated. */
function harness() {
    const calls = [];
    const document = { body: { closest: () => null }, activeElement: null };
    const layoutEffects = [];
    const frames = [];
    const state = { terminals: { local: [{ id: 'first', title: 'Same title' }, { id: 'second', title: 'Same title' }] },
        paneLayouts: {}, contentPresentation: {}, workspaceDocking: {}, workspaceViewRegistry: [], settings: {},
        sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false, activeTabId: 'main',
        setContentDisplayAlias: (...args) => { calls.push(['rename', ...args]); return true; },
        setContentPinned: (...args) => { calls.push(['pin', ...args]); return true; },
        moveContent: (...args) => { calls.push(['move', ...args]); return true; },
        moveWorkspaceContent: (...args) => { calls.push(['dock', ...args]); return false; },
        releasePaneFromSplit: (...args) => { calls.push(['release', ...args]); delete state.workspaceDocking.local.placements[args[1].contentId]; return true; },
        resetContentOrder: () => calls.push(['reset-order']), resetWorkspaceDocking: () => { calls.push(['reset-docking']); return true; },
        showToast: (...args) => calls.push(['toast', ...args]),
    };
    const store = selector => selector(state); store.getState = () => state;
    const slots = []; let cursor = 0;
    const slot = initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return i; };
    const hooks = { ...React, useMemo: fn => fn(), useEffect: () => {}, useLayoutEffect: effect => { layoutEffects.push(effect); },
        useRef: initial => slots[slot({ current: initial })],
        useState: initial => { const i = slot(initial); return [slots[i], value => { slots[i] = value; }]; },
    };
    const dependencies = { react: hooks, 'react/jsx-runtime': jsx,
        '../../store/useAppStore': { useAppStore: store },
        '../layout/navigation/workspaceTabsMenu': domain('components/layout/navigation/workspaceTabsMenu.ts'),
        '../ui/ContextMenu': { ContextMenu }, './DisplayAliasDialog': { DisplayAliasDialog },
        './workspaceActionsContext': { WorkspaceActionsContext: context },
        '../../features/workspace/application/viewRegistrationAdapters': { registrationForContent: () => ({ label: 'Shell', allowedLocations: ['workspace', 'bottom-panel'] }) },
    };
    const { outputText } = ts.transpileModule(readFileSync(new URL('../src/components/workspace/WorkspaceContextActions.tsx', import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    });
    const module = { exports: {} };
    runInNewContext(outputText, { module, exports: module.exports, document, requestAnimationFrame: fn => frames.push(fn), CSS: { escape: value => value }, require: name =>
        Object.hasOwn(dependencies, name) ? dependencies[name] : domain(name.replace('../../', '') + '.ts') });
    let props = { connectionId: 'local', tabId: 'main', active: true, openRequest: 0,
        onSetHidden: (...args) => { calls.push(['hide', ...args]); return true; },
        onSelectContent: id => { calls.push(['select', id]); return true; },
        onRevealAll: () => { calls.push(['reveal']); return true; }, children: null };
    const render = (patch = {}) => { props = { ...props, ...patch }; cursor = 0; layoutEffects.length = 0; return module.exports.WorkspaceContextActions(props); };
    const children = () => React.Children.toArray(render().props.children);
    const menu = () => children().find(node => node.type === ContextMenu);
    const dialog = () => children().find(node => node.type === DisplayAliasDialog);
    const event = { currentTarget: { focus() {}, querySelector: () => null, hasAttribute: () => false, closest: () => ({}), getBoundingClientRect: () => ({ left: 4, bottom: 8 }) }, preventDefault() {}, stopPropagation() {} };
    const open = (ids, currentTarget = event.currentTarget, extra = []) => { render().props.value.open({ ...event, currentTarget }, ids, extra); return menu(); };
    const items = () => menu()?.props.items ?? [];
    const item = label => items().find(item => item.label === label);
    return { state, calls, render, open, item, menu, dialog, document,
        flushLayout: () => layoutEffects.forEach(effect => effect()), flushFrames: () => frames.splice(0).forEach(fn => fn()) };
}

test('removed pane-menu openers recover to selection buttons or the empty strip without stealing focus', () => {
    for (const scenario of ['survivor', 'empty', 'outside', 'inactive', 'connected-opener', 'detached-strip']) {
        const ui = harness();
        const focused = [];
        const control = name => ({ focus(options) { focused.push([name, options?.preventScroll]); ui.document.activeElement = this; } });
        const button = control('selection');
        const wrapper = control('wrapper');
        const strip = { ...control('strip'), isConnected: scenario !== 'detached-strip',
            querySelector: selector => selector === '[data-workspace-tab-contents] [data-workspace-tab-trigger]'
                ? (scenario === 'empty' ? null : button) : wrapper };
        const opener = { ...control('opener'), isConnected: true };
        const target = { querySelector: () => opener, closest: () => strip,
            getBoundingClientRect: () => ({ left: 4, bottom: 8 }) };
        ui.open([second], target);
        focused.length = 0;
        opener.isConnected = scenario === 'connected-opener';
        ui.document.activeElement = scenario === 'outside' ? { closest: () => null } : ui.document.body;
        if (scenario === 'inactive') ui.state.activeTabId = 'other';
        ui.menu().props.onClose(); ui.render(); ui.flushLayout();
        assert.deepEqual(focused, scenario === 'survivor' ? [['selection', true]]
            : scenario === 'empty' ? [['strip', true]] : [], scenario);
        assert.deepEqual(ui.calls, [], 'DOM focus recovery must not activate or mutate content');
    }
});

test('dock headers and menus share exact Return to tabs without opening or closing resources', () => {
    for (const via of ['header', 'menu']) {
        const ui = harness();
        ui.state.workspaceDocking = { local: { version: 1, placements: { [first]: 'primary-sidebar', [second]: 'bottom-panel' } } };
        ui.open([second]);
        assert.equal(ui.render().props.value.canReturnToTabs(second), true);
        if (via === 'header') ui.render().props.value.returnToTabs(second);
        else ui.item('Return to tabs').action();
        assert.deepEqual(JSON.parse(JSON.stringify(ui.calls)), [['release', 'local', { contentId: second }], ['select', second]]);
        assert.equal(ui.state.workspaceDocking.local.placements[first], 'primary-sidebar');
        assert.equal(ui.item('Return to tabs'), undefined);
    }
});

test('menu return recovers the exact tab after header removal, not the generic first-tab fallback', () => {
    for (const scenario of ['returned', 'outside', 'inactive', 'connected-header']) {
        const ui = harness(); const focused = [];
        ui.state.workspaceDocking = { local: { version: 1, placements: { [second]: 'bottom-panel' } } };
        const control = name => ({ isConnected: true, closest: () => null,
            focus(options) { focused.push([name, options?.preventScroll]); ui.document.activeElement = this; } });
        const firstTab = control('first'), returnedTab = control('returned');
        const strip = { ...control('strip'), querySelector: () => firstTab, querySelectorAll: () => [
            { dataset: { workspaceTabContents: JSON.stringify([first]) }, querySelector: () => firstTab },
            { dataset: { workspaceTabContents: JSON.stringify([second]) }, querySelector: () => returnedTab },
        ] };
        const opener = { ...control('header'), querySelector: () => null, closest: () => strip,
            getBoundingClientRect: () => ({ left: 4, bottom: 8 }) };
        ui.document.querySelector = () => strip;
        ui.open([second], opener);
        const menu = ui.menu(); const menuControl = { isConnected: true, closest: () => ({}) };
        ui.document.activeElement = menuControl;
        ui.item('Return to tabs').action(); menu.props.onClose();
        // React batches the action and dismissal, then removes the dock header
        // before layout effects. The menu's normal opener recovery runs first.
        opener.isConnected = scenario === 'connected-header'; menuControl.isConnected = false;
        ui.document.activeElement = scenario === 'outside' ? control('outside')
            : scenario === 'connected-header' ? opener : ui.document.body;
        if (scenario === 'inactive') ui.state.activeTabId = 'other';
        focused.length = 0; ui.render(); ui.flushLayout(); ui.flushFrames();
        assert.deepEqual(focused, scenario === 'returned' ? [['returned', true]] : [], scenario);
        assert.deepEqual(ui.calls.map(call => call[0]), ['release', 'select']);
        // A consumed return request must not redirect a later ordinary dismissal.
        ui.state.activeTabId = 'main'; opener.isConnected = true; ui.open([first], opener);
        ui.document.activeElement = ui.document.body; opener.isConnected = false;
        ui.menu().props.onClose(); focused.length = 0; ui.render(); ui.flushLayout(); ui.flushFrames();
        assert.deepEqual(focused, [['first', true]], `${scenario}: no stale return target`);
    }
});

test('stale Return to tabs refuses changed scope, hidden/missing/undocked targets and unsupported or protected saves', () => {
    for (const failure of ['inactive', 'restoring', 'blocked', 'unloaded', 'hidden', 'missing', 'undocked', 'future', 'refused']) {
        const ui = harness();
        ui.state.workspaceDocking = { local: { version: 1, placements: { [second]: 'bottom-panel' } } };
        ui.open([second]); const action = ui.item('Return to tabs').action;
        if (failure === 'inactive') ui.state.activeTabId = 'other';
        if (failure === 'restoring') ui.state.isRestoring = true;
        if (failure === 'blocked') ui.state.sessionPersistenceBlocked = true;
        if (failure === 'unloaded') ui.state.sessionLoaded = false;
        if (failure === 'hidden') ui.state.contentPresentation.local = { version: 3, items: { [second]: { hidden: true } } };
        if (failure === 'missing') ui.state.terminals.local = [];
        if (failure === 'undocked') delete ui.state.workspaceDocking.local.placements[second];
        if (failure === 'future') ui.state.workspaceDocking.local.version = 99;
        if (failure === 'refused') ui.state.releasePaneFromSplit = (...args) => { ui.calls.push(['release', ...args]); return false; };
        action();
        assert.equal(ui.calls.some(call => call[0] === 'select'), false, failure);
        assert.equal(ui.calls.filter(call => call[0] === 'release').length, failure === 'refused' ? 1 : 0, failure);
    }
});

test('returning a pane reports partial selection failure and restores removed-button focus without stealing outside focus', () => {
    for (const outside of [false, true]) {
        const ui = harness(); const focused = [];
        ui.state.workspaceDocking = { local: { version: 1, placements: { [second]: 'bottom-panel' } } };
        const opener = { isConnected: true }; ui.document.activeElement = opener;
        const button = { focus(options) { focused.push(options); } };
        ui.document.querySelector = () => ({ querySelectorAll: () => [{ dataset: { workspaceTabContents: JSON.stringify([first]) } },
            { dataset: { workspaceTabContents: JSON.stringify([second]) }, querySelector: () => button }] });
        ui.render({ onSelectContent: () => { opener.isConnected = false; ui.document.activeElement = outside ? {} : ui.document.body; return false; } });
        ui.render().props.value.returnToTabs(second); ui.render(); ui.flushLayout(); ui.flushFrames();
        assert.equal(ui.calls.at(-1)[1], 'info');
        assert.equal(focused.length, outside ? 0 : 1);
        if (!outside) assert.equal(focused[0].preventScroll, true);
    }
});

test('one contextual action set addresses exact instances even with duplicate labels', () => {
    const ui = harness(); ui.open([second]);
    ui.item('Pin').action(); ui.item('Hide').action();
    assert.deepEqual(ui.calls, [['pin', 'local', second, true], ['hide', second, true]]);
    ui.item('Rename…').action(); ui.dialog().props.onSave('Personal name');
    assert.deepEqual(ui.calls.at(-1), ['rename', 'local', second, 'Personal name']);
    assert.equal(ui.dialog().props.defaultTitle, 'Same title');
});

test('split menus identify individual members instead of silently renaming a group owner', () => {
    const ui = harness(); ui.open([first, second]);
    const groups = ui.menu().props.items.filter(item => item.label === 'Same title');
    assert.equal(groups.length, 2);
    groups[1].children.find(item => item.label === 'Pin').action();
    assert.deepEqual(ui.calls, [['pin', 'local', second, true]]);
});

test('recovery is available without a selected pane and selects the exact revealed instance', () => {
    const ui = harness();
    ui.state.contentPresentation.local = { version: 3, items: { [first]: { hidden: true }, [second]: { hidden: true } } };
    ui.open([]);
    ui.item('Show hidden panes').children[1].action();
    ui.item('Show all panes').action();
    assert.deepEqual(ui.calls, [['hide', second, false], ['select', second], ['reveal']]);
});

test('successful reveal with refused selection reports partial success, not unchanged content', () => {
    const ui = harness();
    ui.state.contentPresentation.local = { version: 3, items: { [second]: { hidden: true } } };
    ui.render({ onSelectContent: id => { ui.calls.push(['select', id]); return false; } });
    ui.open([]); ui.item('Show hidden panes').children[0].action();
    assert.deepEqual(ui.calls.slice(0, 2), [['hide', second, false], ['select', second]]);
    assert.equal(ui.calls[2][1], 'info');
    assert.match(ui.calls[2][2], /Pane shown/);
    assert.equal(ui.calls.filter(call => call[0] === 'toast' && call[1] === 'error').length, 0);
});

test('refused reveal never attempts selection and reports unchanged content', () => {
    const ui = harness();
    ui.state.contentPresentation.local = { version: 3, items: { [second]: { hidden: true } } };
    ui.render({ onSetHidden: (...args) => { ui.calls.push(['hide', ...args]); return false; } });
    ui.open([]); ui.item('Show hidden panes').children[0].action();
    assert.deepEqual(ui.calls[0], ['hide', second, false]);
    assert.equal(ui.calls[1][1], 'error');
    assert.match(ui.calls[1][2], /unchanged/);
    assert.equal(ui.calls.some(call => call[0] === 'select'), false);
});

test('read-only readiness, inactive workspaces and closed IDs cannot mutate through menus', () => {
    const ui = harness(); ui.state.isRestoring = true; ui.open([first]);
    assert.equal(ui.item('Pin').disabled, true); assert.equal(ui.item('Rename…').disabled, true);
    ui.item('Rename…').action(); assert.equal(ui.dialog(), undefined);
    ui.state.isRestoring = false; ui.open([first]); const pin = ui.item('Pin');
    ui.state.activeTabId = 'other'; pin.action(); assert.deepEqual(ui.calls, []);
    ui.state.activeTabId = 'main'; ui.state.terminals.local = []; assert.equal(ui.menu(), undefined);
    ui.render({ active: false }); ui.open([first]); assert.equal(ui.menu(), undefined);
});

test('single, grouped and empty pane menus omit arrangement without changing saved placement or order', () => {
    const labels = items => items.flatMap(item => [item.label, ...labels(item.children ?? [])]);
    for (const ids of [[], [first], [first, second]]) {
        const ui = harness();
        const docking = { local: { placements: { [second]: 'primary-sidebar' } } };
        const presentation = { version: 3, order: [second, first], items: { [second]: { pinned: true } } };
        const terminals = ui.state.terminals.local;
        ui.state.workspaceDocking = docking;
        ui.state.contentPresentation.local = presentation;
        ui.open(ids);
        const menuLabels = labels(ui.menu().props.items);
        for (const removed of ['Arrange', 'Move earlier', 'Move later', 'Move to', 'Reset tab order', 'Reset docking']) {
            assert.equal(menuLabels.includes(removed), false, `${removed} absent for ${ids.length} selected panes`);
        }
        assert.equal(ui.state.workspaceDocking, docking);
        assert.equal(ui.state.contentPresentation.local, presentation);
        assert.equal(ui.state.terminals.local, terminals);
        assert.deepEqual(ui.calls, [], 'opening the simplified menu does not mutate content');
    }
});

test('removed contents and preset controls have no production entry point', () => {
    const layout = readFileSync(new URL('../src/components/layout/MainLayout.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(layout, /WorkspaceContentButton|WorkspaceLayoutButton|layoutsOpenRequest/);
    for (const file of ['WorkspaceContents', 'WorkspaceContentButton', 'WorkspaceLocationControl', 'WorkspaceLayoutButton', 'WorkspaceLayouts', 'WorkspaceLayoutDiagram', 'useWorkspaceLayoutActions']) {
        assert.equal(existsSync(new URL(`../src/components/workspace/${file}.tsx`, import.meta.url)), false);
    }
});

test('simplified pane menus preserve caller-owned split, ungroup and close actions', () => {
    for (const ids of [[first], [first, second]]) {
        const ui = harness();
        const invoked = [];
        const extra = ['Split right', 'Ungroup', 'Close'].map(label => ({ label, action: () => invoked.push(label) }));
        ui.open(ids, undefined, extra);
        for (const item of extra) {
            assert.equal(ui.item(item.label), item, 'layout callbacks are retained without replacement');
            ui.item(item.label).action();
        }
        assert.deepEqual(invoked, ['Split right', 'Ungroup', 'Close']);
        assert.deepEqual(ui.calls, []);
    }
});

test('pane menus retain naming, pinning, hiding, strip placement and recovery without arrangement or presets', () => {
    const ui = harness();
    ui.state.contentPresentation.local = { version: 3, items: { [second]: { hidden: true } } };
    ui.open([first]);
    for (const label of ['Rename…', 'Pin', 'Hide', 'Pane tab position', 'Show hidden panes', 'Show all panes']) {
        assert.ok(ui.item(label), label);
    }
    assert.equal(ui.item('Arrange'), undefined);
    assert.equal(ui.item('Layouts'), undefined);
    assert.ok(ui.item('Show all panes'));
});
