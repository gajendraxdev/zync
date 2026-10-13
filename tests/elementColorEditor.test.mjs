import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../.tmp-agent-tests/src/components/ui/Button.js';
import { Input } from '../.tmp-agent-tests/src/components/ui/Input.js';
import { Select } from '../.tmp-agent-tests/src/components/ui/Select.js';
import { ColorPicker } from '../.tmp-agent-tests/src/components/ui/ColorPicker.js';
import { ElementColorPreview } from '../.tmp-agent-tests/src/features/appearance/presentation/ElementColorPreview.js';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';

const domain = load('features/appearance/domain/elementColors.ts');
const contrast = load('features/appearance/domain/colorContrast.ts');
const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
const tick = () => new Promise(resolve => setImmediate(resolve));
const Tooltip = ({ children }) => children;
function harness(overrides = {}) {
    const slots = []; let cursor = 0; const calls = [];
    const slot = initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return index; };
    const hooks = { ...React, useEffect: () => {}, useId: () => 'hint', useRef: initial => slots[slot({ current: initial })],
        useState: initial => { const index = slot(initial); return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; } };
    const module = { exports: {} };
    const dependencies = { react: hooks, 'react/jsx-runtime': jsx,
        '../../../../features/appearance/domain/elementColors': domain, '../../../../features/appearance/domain/colorContrast': contrast,
        '../../../../features/appearance/presentation/useElementColorSamples': { useElementColorSamples: () => ({ 'mainTabs.background': '#18181b', 'mainTabs.foreground': '#ffffff' }) },
        '../../../../features/appearance/presentation/elementColorContrast': load('features/appearance/presentation/elementColorContrast.ts'),
        '../../common/Section': { Section: ({ children }) => React.createElement('section', {}, children) },
        '../../../../features/appearance/presentation/ElementColorPreview': { ElementColorPreview },
        '../../../ui/Button': { Button }, '../../../ui/Input': { Input }, '../../../ui/Select': { Select }, '../../../ui/ColorPicker': { ColorPicker },
        '../../../ui/Tooltip': { Tooltip } };
    const source = readFileSync(new URL('../src/components/settings/tabs/appearance/AppearanceElementColorsSection.tsx', import.meta.url), 'utf8');
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
        { module, exports: module.exports, document: { activeElement: null }, cancelAnimationFrame() {}, requestAnimationFrame: () => 1,
            require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
    const props = { value: undefined, active: false, onChange: async change => { calls.push(change); props.value = domain.changeElementColors(domain.parseElementColors(props.value), change); }, ...overrides };
    const render = () => { cursor = 0; return module.exports.AppearanceElementColorsSection(props); };
    const button = label => elements(render()).find(item => item.type === Button && item.props.children === label);
    const input = () => elements(render()).find(item => item.type === Input && item.props.label === 'Hex color');
    const select = label => elements(render()).find(item => item.type === Select && item.props.label === label);
    const pickers = () => elements(render()).filter(item => item.type === ColorPicker);
    return { props, calls, render, button, input, select, pickers, draft: value => input().props.onChange({ target: { value } }),
        async click(label) { button(label).props.onClick(); await tick(); } };
}

test('drafts do not save; explicit Apply normalizes and publishes only on acknowledgement', async () => {
    const editor = harness(); editor.draft('#AbCdEf'); assert.deepEqual(editor.calls, []);
    await editor.click('Apply color'); assert.deepEqual(structuredClone(editor.calls), [{ type: 'set', key: 'mainTabs.background', color: '#abcdef' }]);
    assert.equal(editor.input().props.value, '#abcdef');
    assert.match(renderToStaticMarkup(editor.render()), /Color saved/);
});

test('one area selector and visible role swatches replace the role dropdown and native color input', () => {
    const editor = harness();
    assert.equal(editor.select('Interface area').props.portal, true);
    assert.equal(editor.select('Color role'), undefined);
    assert.deepEqual(editor.pickers().map(picker => picker.props.label), ['Background', 'Text', 'Border', 'Active background', 'Active text']);
    assert.doesNotMatch(renderToStaticMarkup(editor.render()), /type="color"/);
});

test('swatches edit detached per-role drafts and preserve scope on explicit Apply', async () => {
    const editor = harness();
    const text = editor.pickers().find(picker => picker.props.label === 'Text');
    text.props.onOpen(); text.props.onChange('#112233');
    assert.deepEqual(editor.calls, []);
    assert.match(renderToStaticMarkup(editor.render()), /Unsaved/);
    assert.equal(editor.input().props.value, '#112233');
    await editor.click('Apply color');
    assert.deepEqual(structuredClone(editor.calls.at(-1)), { type: 'set', key: 'mainTabs.foreground', color: '#112233' });
    editor.select('Interface area').props.onChange('sidebar');
    assert.deepEqual(editor.pickers().map(picker => picker.props.label), ['Background', 'Text', 'Border']);
});

test('workspace preview retains drafts from other areas without publishing them', () => {
    const editor = harness({ value: { version: 1, overrides: { 'sidebar.background': '#102030' } } });
    editor.draft('#112233');
    editor.select('Interface area').props.onChange('terminal'); editor.draft('#445566');
    const preview = elements(editor.render()).find(item => item.type === ElementColorPreview);
    assert.equal(preview.props.colors['mainTabs.background'], '#112233');
    assert.equal(preview.props.colors['terminal.background'], '#445566');
    assert.equal(preview.props.colors['sidebar.background'], '#102030');
    assert.deepEqual(editor.calls, []);
});

test('invalid/IME input never saves, per-key drafts survive switching and unsupported/loading disable writes', async () => {
    const editor = harness(); editor.draft('bad'); assert.equal(editor.button('Apply color').props.disabled, true);
    editor.draft('#ffffff'); editor.input().props.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true } }); await tick(); assert.deepEqual(editor.calls, []);
    editor.select('Interface area').props.onChange('terminal'); editor.draft('#123456');
    editor.select('Interface area').props.onChange('mainTabs'); assert.equal(editor.input().props.value, '#ffffff');
    assert.match(renderToStaticMarkup(editor.render()), /below the 4.5:1 target/);
    for (const props of [{ loading: true }, { value: { version: 999, overrides: {} } }]) {
        const blocked = harness(props); blocked.draft('#123456'); await blocked.click('Apply color'); assert.deepEqual(blocked.calls, []);
        assert.equal(blocked.button('Reset all colors').props.disabled, true);
    }
});

test('reset confirmation can cancel; individual/area/all remove only their intended overrides', async () => {
    const editor = harness({ value: { version: 1, overrides: { 'mainTabs.background': '#000000', 'terminal.cursor': '#ffffff' } } });
    await editor.click('Reset all colors'); await editor.click('Cancel'); assert.deepEqual(editor.calls, []);
    await editor.click('Use theme color'); assert.equal(editor.props.value.overrides['mainTabs.background'], undefined); assert.equal(editor.props.value.overrides['terminal.cursor'], '#ffffff');
    editor.select('Interface area').props.onChange('terminal'); await editor.click('Reset area'); await editor.click('Restore theme colors');
    assert.deepEqual(structuredClone(editor.calls.at(-1)), { type: 'reset-area', area: 'terminal' });
    await editor.click('Reset all colors'); await editor.click('Restore theme colors'); assert.equal(editor.calls.at(-1).type, 'reset-all');
});

test('all color actions retain full wrapping labels and shared scoped tooltips, including disabled actions', () => {
    const editor = harness();
    const tooltips = elements(editor.render()).filter(item => item.type === Tooltip);
    assert.equal(tooltips.length, 4);
    assert.match(tooltips[0].props.content, /draft background.*main tabs/);
    assert.match(tooltips[1].props.content, /Remove.*override.*follow the theme/);
    assert.match(tooltips[2].props.content, /main tabs.*Other areas stay unchanged/);
    assert.match(tooltips[3].props.content, /every element.*Theme, accent and other settings stay unchanged/);
    for (const tooltip of tooltips) {
        assert.match(tooltip.props.contentClassName, /whitespace-normal/);
        const button = tooltip.props.children;
        assert.equal(tooltip.props.disabledTrigger, button.props.disabled, 'only disabled buttons request a pointer wrapper');
        assert.equal(button.type, Button); assert.equal(button.props.type, 'button');
        assert.match(button.props.className, /whitespace-normal/);
        assert.match(button.props.className, /h-auto/);
        assert.doesNotMatch(button.props.children, /…/);
        assert.equal(button.props.title, undefined);
    }
    assert.equal(editor.button('Apply color').props.disabled, true);
    editor.select('Interface area').props.onChange('terminal');
    assert.match(elements(editor.render()).filter(item => item.type === Tooltip)[2].props.content, /terminal/);
    assert.deepEqual(editor.calls, []);
});

test('failed acknowledgement keeps drafts and an exact retry; pending duplicate actions are suppressed', async () => {
    let reject; let calls = 0;
    const editor = harness({ onChange: () => { calls++; return new Promise((_, no) => { reject = no; }); } });
    editor.draft('#123456'); const sameButton = editor.button('Apply color'); sameButton.props.onClick(); sameButton.props.onClick();
    assert.equal(calls, 1); assert.equal(editor.button('Apply color').props.disabled, true);
    reject(Error('private native path')); await tick(); assert.equal(editor.input().props.value, '#123456');
    const html = renderToStaticMarkup(editor.render()); assert.match(html, /Retry the same change/); assert.doesNotMatch(html, /private native path/);
    editor.button('Apply color').props.onClick(); assert.equal(calls, 2); reject(Error('again')); await tick();
});
