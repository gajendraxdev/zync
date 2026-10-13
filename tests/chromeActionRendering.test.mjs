import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';

const domain = load('features/workspace/domain/chromeActions.ts');
function source(path, dependencies, globals = {}) {
    const module = { exports: {} };
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module, exports: module.exports, ...globals,
        require: name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
    return module.exports;
}
const chrome = source('src/components/layout/ChromeActionItems.tsx', {
    react: React, 'react/jsx-runtime': jsx, '../../features/workspace/domain/chromeActions': domain,
});
const marker = name => () => React.createElement('span', { 'data-indicator': name }, name);
const { chromeVisibilityMenu } = source('src/components/layout/chromeVisibilityMenu.ts', {
    '../../features/workspace/domain/chromeActions': domain,
});

function status(value, { rightBell = true } = {}) {
    const state = { activeConnectionId: 'ssh', connections: [{ id: 'ssh', status: 'connected', name: 'Host A' }],
        settings: { chromeActions: value, statusBar: {}, keybindings: {} }, editorDiagnosticsCount: 2,
        editorDiagnosticsSeverity: 'error', editorDiagnosticsVisible: false, lastAction: { type: 'error', message: 'Protected failure message' } };
    const latency = [];
    const Icon = marker('icon');
    const { StatusBar } = source('src/components/layout/StatusBar.tsx', {
        '../../features/workspace/application/sidebarPresentation': load('features/workspace/application/sidebarPresentation.ts'),
        '../../features/shortcuts/actions': { runShortcutCommand() {} },
        'react/jsx-runtime': jsx, 'lucide-react': { CircleAlert: Icon, Monitor: Icon, PanelLeft: Icon, Sparkles: Icon, Wifi: Icon, WifiOff: Icon },
        '../../features/connections/application/tabService': { LOCAL_TERMINAL_CONNECTION_ID: 'local' },
        '../../features/editor/editorStatus': { useEditorStatus: () => 'Line 7, Column 3' },
        '../../lib/shortcuts': { formatShortcutLabel: value => value },
        '../../store/useAppStore': { useAppStore: select => select(state) }, './ChromeActionItems': chrome,
        './useChromeCustomizationMenu': { useChromeCustomizationMenu: () => ({}) },
        '../../lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') }, '../ui/Tooltip': { Tooltip: ({ children }) => children },
        '../file-manager/StatusBarTransferIndicator': { StatusBarTransferIndicator: marker('transfers') },
        '../../features/updater/StatusBarUpdateIndicator': { StatusBarUpdateIndicator: marker('updates') },
        '../../features/feedbackInbox/StatusBarInboxIndicator': { StatusBarInboxIndicator: marker('inbox') },
        '../notifications/NotificationBell': { NotificationBell: marker('notifications'), useNotificationBellPlacement: () => ({ showInStatusLeft: !rightBell, showInStatusRight: rightBell }) },
        '../../features/statusBar': { DEFAULT_STATUS_BAR_SETTINGS: { showConnectionLatency: true }, StatusBarLatency: marker('latency'),
            useConnectionLatency: options => { latency.push(options); return 20; } },
    }, { window: { electronUtils: { platform: 'win32' } } });
    return { html: renderToStaticMarkup(React.createElement(StatusBar)), latency };
}

test('real status bar keeps mandatory indicators, connection identity and latency when optional controls are hidden', () => {
    let preferences = domain.parseChromeActions(undefined);
    preferences = domain.changeChromeActions(preferences, { type: 'hidden', id: 'status.editor', value: true });
    preferences = domain.changeChromeActions(preferences, { type: 'hidden', id: 'status.ai', value: true });
    const { html, latency } = status(preferences);
    assert.doesNotMatch(html, /Line 7|Toggle AI Sidebar/);
    for (const text of ['transfers', 'updates', 'inbox', 'notifications', 'Protected failure message', 'Host A', 'Show diagnostics (2)', 'Hide Sidebar']) assert.ok(html.includes(text), text);
    assert.deepEqual(structuredClone(latency), [{ connectionId: 'ssh', enabled: true, isLive: true }]);
});

test('status ordering changes only its lane and notification placement remains feature-owned', () => {
    const defaults = status(undefined).html;
    const preferences = domain.changeChromeActions(domain.parseChromeActions(undefined), { type: 'move', id: 'status.ai', targetId: 'status.editor' });
    const html = status(preferences).html;
    assert.ok(defaults.indexOf('Line 7') < defaults.indexOf('Toggle AI Sidebar'));
    assert.ok(html.indexOf('Toggle AI Sidebar') < html.indexOf('Line 7'));
    assert.ok(html.indexOf('Host A') < html.indexOf('Toggle AI Sidebar'));
    const leftBell = status(preferences, { rightBell: false }).html;
    assert.equal((leftBell.match(/data-indicator="notifications"/g) || []).length, 1);
    assert.ok(leftBell.indexOf('data-indicator="notifications"') < leftBell.indexOf('Host A'));
    assert.equal(status({ version: 99 }).html, defaults, 'Unsupported raw preferences display safe defaults');
});

test('customization editor offers visibility and scoped reset only, while explaining action groups', () => {
    const { ChromeActionsSection } = source('src/components/settings/tabs/layout/ChromeActionsSection.tsx', {
        react: React, 'react/jsx-runtime': jsx,
        '../../../../features/workspace/domain/chromeActions': domain,
        '../../common/Section': { Section: ({ children }) => children },
        '../../../ui/Button': { Button: ({ children, ...props }) => React.createElement('button', props, children) },
        '../../../ui/Switch': { Switch: ({ label, checked, disabled, showLabel, description }) => React.createElement('button', { role: 'switch', 'aria-label': label, 'aria-checked': checked, disabled }, showLabel && label, description) },
    });
    const render = area => renderToStaticMarkup(React.createElement(ChromeActionsSection, { area, onChange() {} }));
    const html = render('workspaceToolbar');
    for (const markup of [html, render('statusBar')]) {
        assert.doesNotMatch(markup, /draggable|Drag |Move |change the order|Workspace layouts/);
        assert.equal((markup.match(/<button(?![^>]*role="switch")/g) ?? []).length, 1, 'only the scoped reset button remains alongside visibility switches');
    }
    assert.match(html, /split buttons show or hide together/);
    assert.match(html, /session snippets and terminal controls/);
    assert.match(html, /The Add button stays available/);
    for (const area of domain.CHROME_ACTION_AREAS) {
        const markup = render(area);
        const expected = domain.CHROME_ACTIONS.filter(action => action.area === area && action.optional);
        assert.equal((markup.match(/data-chrome-action-row=/g) ?? []).length, expected.length);
        for (const action of expected) assert.ok(markup.includes(`>${action.label}`), 'shared labeled switch renders a clickable label');
        for (const action of domain.CHROME_ACTIONS.filter(action => action.area === area && !action.optional)) {
            assert.ok(!markup.includes(`data-chrome-action-row="${action.id}"`), 'protected actions are not presented as editable rows');
        }
        assert.doesNotMatch(markup, /Always available when relevant/);
    }
    assert.match(render('statusBar'), /Essential status indicators and sidebar recovery remain available when needed/);
});

test('visibility menus mirror optional Settings choices, saved order and checks, protecting loading/future choices', () => {
    const calls = [];
    let value = domain.parseChromeActions(undefined);
    value = domain.changeChromeActions(value, { type: 'hidden', id: 'terminal.find', value: true });
    value = domain.changeChromeActions(value, { type: 'move', id: 'workspace.sessionTools', targetId: 'terminal.find' });
    const toolbar = chromeVisibilityMenu(value, 'workspaceToolbar', (...args) => calls.push(args));
    assert.deepEqual(Array.from(toolbar, item => item.label), ['Session tools', 'Find in terminal', 'Split controls']);
    assert.equal(toolbar[1].checked, false);
    toolbar[1].action(); toolbar[0].action();
    assert.deepEqual(calls, [['terminal.find', false], ['workspace.sessionTools', true]]);
    const status = chromeVisibilityMenu(value, 'statusBar', (...args) => calls.push(args));
    assert.deepEqual(Array.from(status, item => item.label), ['Editor position', 'AI assistant']);
    assert.ok(status.every(item => item.checked && !item.disabled));
    status[0].action();
    assert.deepEqual(calls.at(-1), ['status.editor', true]);
    const movedStatus = domain.changeChromeActions(value, { type: 'move', id: 'status.ai', targetId: 'status.editor' });
    const hiddenStatus = domain.changeChromeActions(movedStatus, { type: 'hidden', id: 'status.ai', value: true });
    const recovery = chromeVisibilityMenu(hiddenStatus, 'statusBar', (...args) => calls.push(args));
    assert.deepEqual(Array.from(recovery, item => item.label), ['AI assistant', 'Editor position']);
    assert.equal(recovery[0].checked, false);
    recovery[0].action();
    assert.deepEqual(calls.at(-1), ['status.ai', false]);
    for (const [preferences, busy] of [[{ version: 99 }, false], [undefined, true]]) {
        for (const area of domain.CHROME_ACTION_AREAS) {
            const entries = chromeVisibilityMenu(preferences, area, () => assert.fail('read-only menu'), busy);
            assert.deepEqual(Array.from(entries, item => item.label), Array.from(domain.CHROME_ACTIONS.filter(action => action.area === area && action.optional), action => action.label));
            for (const entry of entries) { assert.equal(entry.disabled, true); entry.action(); }
        }
    }
});

test('shared chrome context shortcuts route both areas, respect nested menus and restore keyboard focus', async () => {
    for (const area of ['workspaceToolbar', 'statusBar']) {
        let anchor = null; let saving = false; let stateIndex = 0; let refIndex = 0;
        const refs = [];
        const calls = []; const body = {};
        const document = { body, activeElement: body };
        class Element { closest() { return opener; } }
        const opener = { isConnected: true, focus: () => { calls.push('focus'); document.activeElement = opener; } };
        const store = { settings: {}, openSettings: (...args) => calls.push(args), updateChromeActions: async () => {}, showToast: (...args) => calls.push(args) };
        const { useChromeCustomizationMenu } = source('src/components/layout/useChromeCustomizationMenu.tsx', {
            react: { useEffect() {}, useRef: initial => refs[refIndex++] ??= { current: initial },
                useState: () => stateIndex++ === 0 ? [anchor, next => { anchor = next; }] : [saving, next => { saving = next; }] },
            'react/jsx-runtime': jsx,
            '../../store/useAppStore': { useAppStore: select => select(store) },
            '../ui/ContextMenu': { ContextMenu: () => null },
            './chromeVisibilityMenu': { chromeVisibilityMenu },
        }, { document, Element });
        const render = () => { stateIndex = 0; refIndex = 0; return useChromeCustomizationMenu(area); };
        const event = { target: new Element(), currentTarget: { getBoundingClientRect: () => ({ left: 10, bottom: 20 }) },
            clientX: 30, clientY: 40, key: 'F10', shiftKey: true,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; } };
        render().onContextMenu({ ...event, defaultPrevented: true });
        assert.equal(anchor, null);
        render().onContextMenu(event);
        assert.equal(anchor.keyboard, false); assert.equal(anchor.x, 30);
        assert.equal(event.stopped, true);
        event.defaultPrevented = false;
        render().onKeyDown(event);
        assert.equal(anchor.keyboard, true); assert.equal(anchor.x, 10); assert.equal(anchor.y, 20);
        assert.equal(render().menu.props.autoFocus, true);
        render().menu.props.items.at(-1).action();
        assert.deepEqual(calls, ['focus', ['layout', area]]);
        calls.length = 0;
        document.activeElement = { closest: () => null };
        render().menu.props.onClose();
        assert.deepEqual(calls, [], 'outside-control focus is not stolen');
        assert.equal(anchor, null);
        render().item.action();
        assert.deepEqual(calls, [['layout', area]], 'an embedding menu retains ownership of its opener');
        calls.length = 0;
        let reject;
        store.updateChromeActions = intent => { calls.push(structuredClone(intent)); return new Promise((_, fail) => { reject = fail; }); };
        const optional = render().items.find(entry => entry.checked !== undefined && !entry.disabled);
        optional.action(); optional.action();
        assert.equal(calls.length, 1, 'pending changes reject duplicate actions');
        assert.equal(calls[0].type, 'hidden'); assert.equal(calls[0].value, true);
        assert.ok(render().items.filter(entry => entry.checked !== undefined).every(entry => entry.disabled));
        reject(Error('private failure details'));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(saving, false);
        assert.deepEqual(calls[1], ['error', 'Could not save action visibility. Please try again.']);
        assert.equal(store.settings.chromeActions, undefined, 'a failed save does not optimistically change checks');
    }
});
