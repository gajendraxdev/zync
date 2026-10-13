import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';

const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
const stub = () => null;
function source(path, dependencies) {
    const module = { exports: {} };
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module, exports: module.exports,
        require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
    return module.exports;
}

test('Escape has one focused dialog owner, and pending Apply consumes it without dismissing', () => {
    const { consumeDialogEscape } = load('components/ui/dialogEscape.ts');
    const root = { querySelector: () => null }; const parent = { ownerDocument: root }, child = { ownerDocument: root };
    for (const canDismiss of [true, false]) {
        let closed = 0, stopped = 0;
        const event = { key: 'Escape', target: { closest: () => child }, defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation() { stopped++; } };
        assert.equal(consumeDialogEscape(event, parent, true, () => assert.fail('Settings must stay open')), false);
        assert.equal(consumeDialogEscape(event, child, canDismiss, () => closed++), true);
        assert.equal(consumeDialogEscape(event, parent, true, () => assert.fail('No parent dismissal')), false);
        assert.equal(closed, canDismiss ? 1 : 0); assert.equal(stopped, 1);
    }
    for (const key of ['Tab', 'Enter']) assert.equal(consumeDialogEscape({ key }, child, true, stub), false);
    assert.equal(consumeDialogEscape({ key: 'Escape', isComposing: true }, child, true, stub), false);
    root.querySelector = () => ({});
    assert.equal(consumeDialogEscape({ key: 'Escape' }, child, true, () => assert.fail('Popup owns Escape')), false);
    for (const file of ['components/ui/Modal.tsx', 'components/settings/SettingsModal.tsx']) {
        assert.match(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), /consumeDialogEscape/);
    }
});

test('import preview offers every shared area, including split headers and file controls, without saving', () => {
    const colors = load('features/appearance/domain/elementColors.ts');
    const theme = JSON.parse(readFileSync(new URL('./fixtures/themeDocument.json', import.meta.url), 'utf8')).theme;
    const Modal = stub, Button = () => null, Select = () => null, Preview = () => null;
    let area = 'mainTabs', writes = 0;
    const { ThemeImportPreview } = source('features/appearance/presentation/ThemeImportPreview.tsx', {
        react: { useEffect() {}, useState: () => [area, next => { area = next; }] }, 'react/jsx-runtime': jsx,
        '../domain/themeDocument': load('features/appearance/domain/themeDocument.ts'), '../domain/elementColors': colors,
        './themeDocumentPresentation': load('features/appearance/presentation/themeDocumentPresentation.ts'), './ElementColorPreview': { ElementColorPreview: Preview },
        '../../../components/ui/Modal': { Modal }, '../../../components/ui/Button': { Button }, '../../../components/ui/Select': { Select },
    });
    const render = saving => ThemeImportPreview({ theme, saving, error: null, onClose() {}, onApply: () => writes++ });
    const select = elements(render(false)).find(node => node.type === Select);
    assert.deepEqual(Array.from(select.props.options, option => option.value), [...colors.ELEMENT_COLOR_AREAS]);
    for (const value of colors.ELEMENT_COLOR_AREAS) {
        select.props.onChange(value);
        assert.equal(elements(render(false)).find(node => node.type === Preview).props.area, value);
    }
    select.props.onChange('unknown'); assert.equal(area, 'terminal'); assert.equal(writes, 0);
    assert.equal(render(true).props.explicitDismissOnly, true);
    assert.equal(elements(render(true)).find(node => node.type === Select).props.disabled, true);
});

test('accent uses the reusable draft picker and themed preset hints; only Apply commits a custom color', () => {
    const Picker = () => null, Button = () => null, Tooltip = () => null;
    const { AppearanceAccentSection } = source('components/settings/tabs/appearance/AppearanceAccentSection.tsx', {
        'react/jsx-runtime': jsx, '../../common/Section': { Section: stub }, '../../../ui/ColorPicker': { ColorPicker: Picker },
        '../../../ui/Button': { Button }, '../../../ui/Tooltip': { Tooltip }, './themeHelpers': load('components/settings/tabs/appearance/themeHelpers.ts'),
    });
    let draft = '', commits = 0; const presets = [];
    const tree = AppearanceAccentSection({ settings: { accentColor: null }, themeAccent: '#123456', tempAccentColor: '#123456',
        onTempAccentColorChange: value => { draft = value; }, onSelectPresetAccent: value => presets.push(value), onCommitAccentColor: () => commits++ });
    const nodes = elements(tree); const picker = nodes.find(node => node.type === Picker);
    picker.props.onChange('#abcdef'); assert.equal(draft, '#abcdef'); assert.equal(commits, 0); assert.deepEqual(presets, []);
    nodes.find(node => node.type === Button).props.onClick(); assert.equal(commits, 1);
    assert.ok(!nodes.some(node => node.type === 'input' || (typeof node.type === 'string' && node.props.title)));
    assert.equal(nodes.filter(node => node.type === Tooltip).length, 9);
});

test('enabled tooltip controls remain the actual accessible trigger; only disabled controls get a hover wrapper', () => {
    const Trigger = () => null;
    const { Tooltip } = source('components/ui/Tooltip.tsx', {
        react: { ...React, useEffect() {}, useState: () => [false, stub] }, 'react/jsx-runtime': jsx,
        '@radix-ui/react-tooltip': { Root: stub, Trigger, Portal: stub, Content: stub }, '../../lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    });
    const button = React.createElement('button', { type: 'button' }, 'Import');
    for (const disabledTrigger of [false, true]) {
        const trigger = elements(Tooltip({ content: 'Theme hint', children: button, disabledTrigger })).find(node => node.type === Trigger);
        assert.equal(trigger.props.asChild, true);
        assert.equal(trigger.props.children.type, disabledTrigger ? 'span' : 'button');
        if (disabledTrigger) assert.equal(trigger.props.children.props.children, button);
    }
});
