import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** Load pure production contracts with a disposable event target, not a desktop store. */
function contracts() {
    const window = new EventTarget();
    const cache = new Map();
    const load = file => {
        if (cache.has(file)) return cache.get(file).exports;
        const module = { exports: {} };
        cache.set(file, module);
        const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        });
        runInNewContext(outputText, { module, exports: module.exports, window, CustomEvent,
            navigator: { platform: 'Win32' }, require: name => {
                assert.ok(name.startsWith('.'), `Unexpected runtime dependency: ${name}`);
                const base = path.resolve(path.dirname(file), name.replace(/\.js$/, ''));
                const target = [`${base}.ts`, path.join(base, 'index.ts')].find(existsSync);
                assert.ok(target, `Unresolved source: ${name}`);
                return load(target);
            } });
        return module.exports;
    };
    const base = fileURLToPath(new URL('../src/features/shortcuts/', import.meta.url));
    return { window, ...load(path.join(base, 'workspacePresentation.ts')),
        ...load(path.join(base, 'catalog.ts')), ...load(path.join(base, 'route.ts')),
        ...load(path.join(base, 'pluginShortcuts.ts')) };
}
const subject = contracts();
const initial = () => ({
    sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false,
    activeTabId: 'local-tab', tabs: [{ id: 'local-tab', type: 'connection', connectionId: 'local' },
        { id: 'other-tab', type: 'connection', connectionId: 'other' }, { id: 'settings', type: 'settings' }],
    terminals: { local: [{ id: 'shell', title: 'Shell' }] }, paneLayouts: {},
    contentPresentation: { local: { version: 3, items: { '["term","shell"]': { hidden: true } } } },
});
const plain = value => JSON.parse(JSON.stringify(value));

test('catalog owns opt-in command labels, handlers and settings keys', () => {
    const commands = subject.SHORTCUT_CATALOG.filter(command => command.workspaceAction);
    assert.deepEqual(Array.from(commands, command => command.workspaceAction), ['customize-tab', 'contents', 'reveal-all', 'maximize-pane']);
    assert.equal(new Set(commands.map(command => command.id)).size, 4);
    assert.equal(subject.SHORTCUT_CATALOG.some(command => command.id === 'workspaceLayouts'), false);
    for (const command of commands) {
        assert.equal(command.defaultKeys, '');
        assert.equal(command.when, 'app');
        assert.equal(command.configurable, true);
        assert.equal(command.settingsKey, command.id);
        assert.ok(command.label.length > 0);
    }
});

test('availability addresses the actual active tab, never a remembered connection', () => {
    const state = initial();
    assert.equal(subject.workspacePresentationTarget('layouts', state), null);
    assert.equal(subject.dispatchWorkspacePresentationAction('layouts', state), false);
    assert.deepEqual(plain(subject.workspacePresentationTarget('reveal-all', state)), {
        action: 'reveal-all', tabId: 'local-tab', connectionId: 'local',
    });
    state.activeTabId = 'settings';
    assert.deepEqual(plain(subject.workspacePresentationTarget('customize-tab', state)), { action: 'customize-tab', tabId: 'settings' });
    assert.equal(subject.workspacePresentationTarget('contents', state), null);
    assert.equal(subject.workspacePresentationTarget('reveal-all', state), null);
    state.activeTabId = 'removed';
    assert.equal(subject.workspacePresentationTarget('customize-tab', state), null);
});

test('show-all requires live hidden content and writable ready session', () => {
    for (const patch of [{ sessionLoaded: false }, { isRestoring: true }, { sessionPersistenceBlocked: true },
        { contentPresentation: {} }, { terminals: {} }]) {
        assert.equal(subject.workspacePresentationTarget('reveal-all', { ...initial(), ...patch }), null);
    }
    const state = initial();
    state.sessionPersistenceBlocked = true;
    assert.ok(subject.workspacePresentationTarget('contents', state), 'the editor remains discoverable during save protection');
});

test('delivery is exact-owner, revalidated, bounded to known actions and cleaned up', () => {
    let state = initial();
    const received = [];
    const inactive = [];
    const stop = subject.listenWorkspacePresentationActions(() => state,
        target => target.tabId === 'local-tab', target => received.push(plain(target)));
    const stopInactive = subject.listenWorkspacePresentationActions(() => state,
        target => target.tabId === 'other-tab', target => inactive.push(target));
    try {
        assert.equal(subject.dispatchWorkspacePresentationAction('contents', state), true);
        assert.equal(received.length, 1);
        assert.equal(inactive.length, 0);
        for (const detail of [null, 'contents', {}, { action: 'delete', tabId: 'local-tab' },
            { action: 'layouts', tabId: 'local-tab', connectionId: 'local' },
            { action: 'contents', tabId: 'other-tab', connectionId: 'local' },
            { action: 'contents', tabId: 'local-tab', connectionId: 'other' }]) {
            subject.window.dispatchEvent(new CustomEvent(subject.WORKSPACE_PRESENTATION_EVENT, { detail }));
        }
        assert.equal(received.length, 1);
        const stale = subject.workspacePresentationTarget('contents', state);
        state = { ...state, activeTabId: 'settings' };
        subject.window.dispatchEvent(new CustomEvent(subject.WORKSPACE_PRESENTATION_EVENT, { detail: stale }));
        assert.equal(received.length, 1);
        assert.equal(subject.dispatchWorkspacePresentationAction('contents', state), false);
        stop();
        state = initial();
        subject.dispatchWorkspacePresentationAction('contents', state);
        assert.equal(received.length, 1, 'cleanup removes the retained owner listener');
    } finally { stop(); stopInactive(); }
});

test('explicit binding follows terminal-first, local composition and single-action repeat rules', () => {
    const commands = subject.SHORTCUT_CATALOG.filter(command => command.workspaceAction);
    const event = { type: 'keydown', key: 'j', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true,
        repeat: false, isComposing: false, defaultPrevented: false, getModifierState: () => false };
    const calls = [];
    const route = (focus, policy, overrides = {}, extra = {}) => subject.routeShortcut({ ...event, ...extra },
        focus, policy, commands, overrides, id => { calls.push(id); return true; });
    assert.equal(route('app', 'app'), false, 'unbound commands reserve no keys');
    const overrides = { workspaceContents: 'Mod+Shift+J' };
    assert.equal(route('xterm', 'shell', overrides), false);
    assert.equal(route('field', 'app', overrides), false);
    assert.equal(route('app', 'app', overrides, { isComposing: true }), false);
    assert.equal(route('app', 'app', overrides), true);
    assert.equal(route('app', 'app', overrides, { repeat: true }), true);
    assert.deepEqual(calls, ['workspaceContents']);
    assert.equal(route('xterm', 'app', overrides), true);
});

test('host customization commands never enter the iframe navigation allowlist', () => {
    const ids = ['customizeWorkspaceTab', 'workspaceLayouts', 'workspaceContents', 'showAllWorkspacePanes', 'maximizeWorkspacePane'];
    const bindings = subject.pluginShortcutBindings(Object.fromEntries(ids.map(id => [id, 'Mod+Shift+J'])), false);
    for (const id of ids) {
        assert.equal(subject.isPluginShortcutCommandAllowed(id), false);
        assert.equal(bindings.some(binding => binding.id === id), false);
    }
});

/** Real palette adapter with only store/dispatch/command-list boundaries isolated. */
function paletteHarness() {
    let state = { ...initial(), settings: { keybindings: { workspaceContents: 'Mod+Shift+J' } } };
    const dispatched = [];
    const pending = [];
    const Group = ({ children, heading, ...props }) => React.createElement('section', { ...props, 'aria-label': heading }, children);
    const Item = ({ children, onSelect, ...props }) => React.createElement('button', props, children);
    const dependencies = {
        react: React,
        cmdk: { Command: { Group, Item } },
        'zustand/react/shallow': { useShallow: selector => selector },
        '../../store/useAppStore': { useAppStore: Object.assign(select => select(state), { getState: () => state }) },
        '../../features/shortcuts/catalog': { SHORTCUT_CATALOG: subject.SHORTCUT_CATALOG },
        '../../features/shortcuts/actions': { runShortcutCommand: (id, event) => dispatched.push([id, event.type]) },
        '../../features/shortcuts/workspacePresentation': subject,
        '../../lib/shortcuts': { formatShortcutLabel: binding => binding.replace('Mod', 'Ctrl') },
    };
    const module = { exports: {} };
    const require = createRequire(import.meta.url);
    const { outputText } = ts.transpileModule(readFileSync(new URL('../src/components/layout/WorkspaceCommandItems.tsx', import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    });
    runInNewContext(outputText, { module, exports: module.exports, KeyboardEvent: class { constructor(type) { this.type = type; } },
        require: name => dependencies[name] ?? require(name) });
    const render = () => module.exports.WorkspaceCommandItems({ runCommand: run => pending.push(run) });
    return { render, state: () => state, patch: update => { state = { ...state, ...update }; }, dispatched,
        items: () => React.Children.toArray(render()?.props.children), flush: () => pending.splice(0).forEach(run => run()) };
}

test('palette uses catalog labels and effective binding without a second command handler', () => {
    const fixture = paletteHarness();
    const items = fixture.items();
    assert.deepEqual(items.map(item => item.props.value), ['Customize navigation', 'Active workspace tab appearance', 'Show hidden panes', 'Show all panes', 'Toggle maximized pane']);
    assert.match(renderToStaticMarkup(fixture.render()), /Ctrl\+Shift\+J/);
    items.find(item => item.props.value === 'Show hidden panes').props.onSelect();
    assert.equal(fixture.dispatched.length, 0, 'execution waits for palette dismissal');
    fixture.flush();
    assert.deepEqual(fixture.dispatched, [['workspaceContents', 'keydown']]);
});

test('deferred palette action never leaks to a newly selected workspace and unavailable rows disappear', () => {
    const fixture = paletteHarness();
    fixture.items().find(item => item.props.value === 'Show hidden panes').props.onSelect();
    fixture.patch({ activeTabId: 'other-tab' });
    fixture.flush();
    assert.equal(fixture.dispatched.length, 0);
    assert.equal(fixture.items().length, 4, 'other workspace has no live hidden panes');
    fixture.patch({ activeTabId: 'settings' });
    assert.deepEqual(fixture.items().map(item => item.props.value), ['Customize navigation', 'Active workspace tab appearance']);
    fixture.patch({ activeTabId: 'missing' });
    assert.deepEqual(fixture.items().map(item => item.props.value), ['Customize navigation']);
    fixture.items()[0].props.onSelect();
    fixture.patch({ activeTabId: 'other-tab' });
    fixture.flush();
    assert.deepEqual(fixture.dispatched, [['customizeNavigation', 'keydown']], 'global recovery is independent of workspace activation');
});
