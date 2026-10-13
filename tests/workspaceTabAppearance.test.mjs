import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../.tmp-agent-tests/src/components/ui/Button.js';
import { Input } from '../.tmp-agent-tests/src/components/ui/Input.js';
import { Select } from '../.tmp-agent-tests/src/components/ui/Select.js';
import { Toolbar } from '../.tmp-agent-tests/src/components/ui/Toolbar.js';
import { WorkspaceTabsSection } from '../.tmp-agent-tests/src/components/settings/tabs/layout/WorkspaceTabsSection.js';
import * as decoration from '../.tmp-agent-tests/src/components/layout/WorkspaceTabDecoration.js';
import { requestWorkspaceTabCloseFromMenu } from '../.tmp-agent-tests/src/components/layout/useWorkspaceTabCloseFocus.js';
import { loadWorkspaceDomain } from './helpers/loadWorkspaceDomain.mjs';

const domain = loadWorkspaceDomain('features/workspace/domain/mainTabPresentation.ts');
const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];

/** Exercise production callbacks; real focus and popup interaction are browser-tested. */
function editor(overrides = {}) {
    const slots = []; let cursor = 0; const calls = [];
    const slot = initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return index; };
    const hooks = { ...React, useId: () => 'fixture-hint', useRef: initial => slots[slot({ current: initial })],
        useState: initial => { const index = slot(initial); return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; } };
    const dependencies = { react: hooks, 'react/jsx-runtime': jsx, 'lucide-react': icons,
        '../../features/workspace/domain/mainTabPresentation': domain,
        '../ui/Button': { Button }, '../ui/Input': { Input }, '../ui/Select': { Select }, '../ui/Toolbar': { Toolbar },
        './WorkspaceTabDecoration': decoration };
    const module = { exports: {} };
    const source = readFileSync(new URL('../src/components/layout/WorkspaceTabAppearanceControls.tsx', import.meta.url), 'utf8');
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
        { module, exports: module.exports, require: name => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; } });
    const props = { value: undefined, onChange: action => {
        calls.push(action); const result = domain.changeMainTabPresentation(props.value, action);
        if (!result.ok) return false; props.value = result.value; return true;
    }, ...overrides };
    const render = () => { cursor = 0; return module.exports.WorkspaceTabAppearanceControls(props); };
    const button = label => elements(render()).find(item => item.type === Button && (item.props.children === label
        || React.Children.toArray(item.props.children).some(child => child === label)));
    const input = () => elements(render()).find(item => item.type === Input && item.props.label === 'Tab accent');
    const select = label => elements(render()).find(item => item.type === Select && item.props.label === label);
    return { props, calls, render, input, select, button, draft: value => input().props.onChange({ target: { value } }) };
}

test('appearance inherits defaults, strictly resolves close display and ignores unsupported data', () => {
    assert.deepEqual(decoration.resolveWorkspaceTabAppearance(undefined, false), { icon: undefined, accent: undefined, showClose: true, persistentClose: false });
    for (const active of [true, false]) for (const mode of ['always', 'active', 'hidden']) {
        const actual = decoration.resolveWorkspaceTabAppearance({ version: 2, icon: 'star', accent: '#ABCDEF', closeButton: mode }, active);
        const visible = mode === 'always' || (mode === 'active' && active);
        assert.equal(actual.showClose, visible); assert.equal(actual.persistentClose, visible);
        assert.equal(actual.icon, 'star'); assert.equal(actual.accent, '#abcdef');
    }
    for (const raw of [null, { version: 99, icon: 'star' }, { version: 2, accent: 'url(x)' }, { version: 1, icon: 'none' }]) {
        assert.deepEqual(decoration.resolveWorkspaceTabAppearance(raw, true), decoration.resolveWorkspaceTabAppearance(undefined, true));
    }
});

test('drag preview shares validated decorations, has no interactive control and preserves Beta', () => {
    const tab = { id: 'links', type: 'public-urls', title: 'Public URLs', displayAlias: 'My links',
        presentation: { version: 2, icon: 'star', accent: '#ABCDEF', closeButton: 'hidden' } };
    const html = renderToStaticMarkup(React.createElement(decoration.WorkspaceTabDragPreview, { tab, active: true, icon: React.createElement('span', {}, 'Resource icon') }));
    assert.match(html, /data-workspace-tab-icon="star"/); assert.match(html, /background-color:#abcdef/);
    assert.match(html, /My links/); assert.match(html, /Beta/); assert.doesNotMatch(html, /Resource icon|<button|lucide-x|role="tab"/);
    const inherited = renderToStaticMarkup(React.createElement(decoration.WorkspaceTabIcon, { fallback: 'Resource icon' }));
    assert.equal(inherited, 'Resource icon');
    assert.equal(renderToStaticMarkup(React.createElement(decoration.WorkspaceTabIcon, { icon: 'none', fallback: 'Resource icon' })), '');
});

test('host drag previews never show the close symbol, regardless of normal-tab preferences', () => {
    for (const closeButton of [undefined, 'always', 'active', 'hidden']) {
        const tab = { id: 'host', type: 'terminal', title: 'Host',
            presentation: { version: 2, closeButton } };
        const html = renderToStaticMarkup(React.createElement(decoration.WorkspaceTabDragPreview,
            { tab, active: true, icon: React.createElement(icons.Terminal) }));
        assert.match(html, /Host/);
        assert.match(html, /lucide-terminal/);
        assert.doesNotMatch(html, /lucide-x|<button/);
    }
});

test('accent drafts require explicit valid non-IME Apply and clear without affecting other decoration', () => {
    const subject = editor({ value: { version: 2, pinned: true, icon: 'star', closeButton: 'hidden' } });
    subject.draft('#AbCdEf'); assert.equal(subject.calls.length, 0);
    let prevented = 0;
    subject.input().props.onCompositionStart();
    subject.input().props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault() { prevented++; }, stopPropagation() {} });
    subject.button('Apply accent').props.onClick(); assert.equal(subject.calls.length, 0); assert.equal(prevented, 1);
    subject.input().props.onCompositionEnd(); subject.button('Apply accent').props.onClick();
    assert.equal(subject.props.value.accent, '#abcdef'); assert.equal(subject.input().props.value, '#abcdef');
    assert.equal(subject.props.value.pinned, true); assert.equal(subject.props.value.icon, 'star'); assert.equal(subject.props.value.closeButton, 'hidden');
    assert.equal(subject.button('Apply accent').props.disabled, true);
    subject.draft('bad'); assert.equal(subject.button('Apply accent').props.disabled, true);
    subject.button('Apply accent').props.onClick(); assert.equal(subject.calls.length, 1);
    subject.draft(''); subject.button('Apply accent').props.onClick(); assert.equal(subject.props.value.accent, undefined);
    assert.equal(subject.props.value.pinned, true);
});

test('icon/close edits and appearance reset are scoped; failure retains a retryable draft', () => {
    const subject = editor({ value: { version: 2, pinned: true } });
    subject.select('Tab icon').props.onChange('none'); subject.select('Close button override').props.onChange('active');
    assert.equal(subject.props.value.icon, 'none'); assert.equal(subject.props.value.closeButton, 'active');
    const calls = subject.calls.length;
    subject.select('Tab icon').props.onChange('__proto__'); subject.select('Close button override').props.onChange('future');
    assert.equal(subject.calls.length, calls);
    subject.draft('#654321'); subject.button('Reset appearance').props.onClick();
    assert.deepEqual(structuredClone(subject.props.value), { version: 2, pinned: true }); assert.equal(subject.input().props.value, '');
    const rejected = editor({ onChange: () => false }); rejected.draft('#ABCDEF'); rejected.button('Apply accent').props.onClick();
    assert.equal(rejected.input().props.value, '#ABCDEF'); assert.match(renderToStaticMarkup(rejected.render()), /could not be updated/);
    rejected.props.onChange = () => { throw new Error('private details'); };
    rejected.button('Apply accent').props.onClick(); assert.doesNotMatch(renderToStaticMarkup(rejected.render()), /private details/);
    rejected.props.onChange = action => { rejected.props.value = domain.changeMainTabPresentation(rejected.props.value, action).value; return true; };
    rejected.button('Apply accent').props.onClick(); assert.equal(rejected.input().props.value, '#abcdef');
    assert.doesNotMatch(renderToStaticMarkup(rejected.render()), /could not be updated/);
});

test('appearance selectors escape the scrollable customization dialog through the shared portal', () => {
    const subject = editor();
    for (const label of ['Tab icon', 'Close button override']) assert.equal(subject.select(label).props.portal, true);
});

test('close button override is directly available without an Advanced disclosure', () => {
    const subject = editor();
    const tree = subject.render();
    assert.ok(React.Children.toArray(tree.props.children).some(item => item.type === Select
        && item.props.label === 'Close button override'));
    assert.ok(elements(tree).every(item => item.type !== 'details' && item.type !== 'summary'));
    assert.equal(subject.select('Close button override').props.value, 'default');
});

test('unsupported appearance metadata is read-only and the editor contains no lifecycle or ordering actions', () => {
    const original = { version: 99, icon: 'future' };
    const subject = editor({ value: original });
    assert.equal(subject.select('Tab icon').props.disabled, true); assert.equal(subject.select('Close button override').props.disabled, true);
    subject.select('Tab icon').props.onChange('star'); subject.button('Reset appearance').props.onClick();
    subject.draft('#123456'); subject.button('Apply accent').props.onClick(); assert.equal(subject.calls.length, 0);
    assert.equal(subject.props.value, original);
    assert.equal(subject.button('Close tab'), undefined); assert.equal(subject.button('Pin tab'), undefined);
    assert.equal(subject.button('Move left'), undefined);
    assert.doesNotMatch(renderToStaticMarkup(subject.render()), /<details|<summary/);
    assert.ok(elements(subject.render()).filter(item => item.type === Button).every(item => item.props.type === 'button'));
});

test('Context menu close focuses the exact persistent tab before dismissal and the original guarded close', () => {
    const events = []; const document = { activeElement: null };
    const tab = { dataset: { workspaceTab: 'one' }, ownerDocument: document, focus() { events.push('focus'); document.activeElement = this; } };
    const root = { querySelectorAll: () => [tab] };
    const dismiss = () => { assert.equal(document.activeElement, tab); events.push('dismiss'); };
    const close = id => { assert.equal(id, 'one'); events.push('close'); };
    assert.equal(requestWorkspaceTabCloseFromMenu('one', root, dismiss, close), true);
    assert.deepEqual(events, ['focus', 'dismiss', 'close']); events.length = 0;
    for (const list of [null, { querySelectorAll: () => [] }, { querySelectorAll: () => [tab, tab] }]) {
        assert.equal(requestWorkspaceTabCloseFromMenu('one', list, dismiss, close), false);
    }
    assert.equal(requestWorkspaceTabCloseFromMenu('missing', root, dismiss, close), false); assert.deepEqual(events, []);
    const hidden = { ...tab, focus() {} }; document.activeElement = null;
    assert.equal(requestWorkspaceTabCloseFromMenu('one', { querySelectorAll: () => [hidden] }, dismiss, close), false);
});
test('app-wide close mode is inherited, legacy overrides win and invalid globals fall back safely', () => {
    for (const active of [false, true]) for (const mode of ['hover', 'always', 'active', 'hidden']) {
        const actual = decoration.resolveWorkspaceTabAppearance(undefined, active, mode);
        assert.equal(actual.showClose, mode === 'hover' || mode === 'always' || (mode === 'active' && active));
        assert.equal(actual.persistentClose, mode === 'always' || (mode === 'active' && active));
        const override = decoration.resolveWorkspaceTabAppearance({ version: 2, closeButton: 'hidden' }, active, mode);
        assert.equal(override.showClose, false);
    }
    for (const invalid of [null, 1, {}, 'future']) {
        assert.deepEqual(decoration.resolveWorkspaceTabAppearance(undefined, false, invalid),
            decoration.resolveWorkspaceTabAppearance(undefined, false));
    }
});

test('Layout settings uses the shared finite close options and existing save callback', () => {
    const saves = [];
    const tree = WorkspaceTabsSection({
        closeButtonMode: 'future', onCloseButtonModeChange: mode => saves.push(mode) });
    const control = elements(tree).find(item => item.type === Select);
    assert.equal(control.props.label, 'Workspace tab close button');
    assert.equal(control.props.value, 'hover'); assert.equal(control.props.disabled, undefined);
    assert.deepEqual(control.props.options.map(item => item.value), ['hover', 'always', 'active', 'hidden']);
    assert.deepEqual(saves, [], 'render never saves or repairs unknown stored data');
    control.props.onChange('hidden'); assert.deepEqual(saves, ['hidden']);
});
