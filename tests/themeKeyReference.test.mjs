import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';

const colors = load('features/appearance/domain/elementColors.ts');
const themes = load('features/appearance/domain/themeDocument.ts');
const Modal = () => null, Button = () => null, Textarea = () => null, Tooltip = () => null;
const elements = node => React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(elements)] : [];
function source(path, dependencies) {
    const module = { exports: {} };
    runInNewContext(ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { module, exports: module.exports, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
        require: name => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; } });
    return module.exports;
}
const reference = source('features/appearance/presentation/ThemeKeyReference.tsx', {
    react: { useId: () => 'example-hint' }, 'react/jsx-runtime': jsx,
    '../domain/elementColors': colors, '../domain/themeDocument': themes,
    '../../../components/ui/Modal': { Modal }, '../../../components/ui/Button': { Button }, '../../../components/ui/Textarea': { Textarea },
});

test('read-only reference lists every validator/editor key once, grouped by the shared area definitions', () => {
    let closes = 0;
    const tree = reference.ThemeKeyReference({ open: true, onClose: () => closes++ });
    const nodes = elements(tree);
    assert.equal(tree.type, Modal); assert.equal(tree.props.isOpen, true);
    assert.deepEqual(nodes.filter(node => node.type === 'dt').map(node => node.props.children), [...colors.ELEMENT_COLOR_KEYS]);
    assert.deepEqual(nodes.filter(node => node.type === 'summary').map(node => node.props.children[0]),
        [...colors.ELEMENT_COLOR_AREAS].map(area => colors.ELEMENT_COLOR_DEFINITIONS.find(field => field.area === area).areaLabel));
    assert.equal(nodes.filter(node => node.type === 'details').length, colors.ELEMENT_COLOR_AREAS.length);
    assert.deepEqual(nodes.filter(node => node.type === 'code').map(node => node.props.children), [...themes.THEME_PALETTE_KEYS]);
    assert.equal(closes, 0);
    const close = nodes.find(node => node.type === Button);
    assert.equal(close.props.type, 'button'); close.props.onClick(); assert.equal(closes, 1);
});

test('copyable example is a valid replaceable elements block, not a standalone theme or forced full override export', () => {
    const tree = reference.ThemeKeyReference({ open: true, onClose() {} });
    const field = elements(tree).find(node => node.type === Textarea);
    assert.equal(field.props.readOnly, true); assert.equal(field.props.onChange, undefined);
    assert.equal(field.props['aria-describedby'], 'example-hint');
    const block = JSON.parse(field.props.value);
    assert.ok(colors.parseElementColors(block));
    assert.equal(Object.keys(block.overrides).length, 2);
    assert.equal(themes.parseThemeDocument(block), null);
    const theme = JSON.parse(readFileSync(new URL('./fixtures/themeDocument.json', import.meta.url), 'utf8')).theme;
    const result = themes.readThemeJson(JSON.stringify({ ...theme, elements: block }));
    assert.equal(result.elements.overrides['navigation.background'], '#111827');
    assert.equal(result.elements.overrides['statusBar.background'], undefined, 'unlisted keys still inherit');
    assert.deepEqual(Object.keys(result), ['format', 'version', 'name', 'mode', 'palette', 'elements']);
});

test('opening and dismissing the key reference does not pick/export a file, apply a theme or select a palette', () => {
    const slots = []; let cursor = 0;
    const slot = initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return index; };
    const ThemeImportPreview = () => null;
    const { AppearanceThemeFilesSection } = source('components/settings/tabs/appearance/AppearanceThemeFilesSection.tsx', {
        react: { useEffect() {}, useRef: initial => slots[slot({ current: initial })],
            useState: initial => { const index = slot(initial); return [slots[index], value => { slots[index] = value; }]; } },
        'react/jsx-runtime': jsx,
        '../../../../lib/themePayload': { resolveZyncThemeMode: () => assert.fail('Help must not capture colors') },
        '../../../../features/appearance/application/themeFiles': { themeFiles: null },
        '../../../../features/appearance/domain/themeDocument': themes,
        '../../../../features/appearance/presentation/themeDocumentPresentation': { captureThemeDocument: () => assert.fail('Help must not capture colors') },
        '../../../../features/appearance/presentation/ThemeImportPreview': { ThemeImportPreview },
        '../../../../features/appearance/presentation/ThemeKeyReference': reference,
        '../../../ui/Button': { Button }, '../../../ui/Tooltip': { Tooltip }, '../../common/Section': { Section: () => null },
    });
    const noIO = () => assert.fail('Help must not touch file or settings ports');
    const render = () => { cursor = 0; return elements(AppearanceThemeFilesSection({ settings: { theme: 'dark' }, loading: false,
        files: { pick: noIO, export: noIO }, onImport: noIO, onSelectTheme: noIO })); };
    let nodes = render();
    assert.equal(nodes.find(node => node.type === reference.ThemeKeyReference).props.open, false);
    const help = nodes.find(node => node.type === Button && node.props.children === 'View theme keys');
    assert.equal(help.props.type, 'button'); help.props.onClick();
    nodes = render();
    const opened = nodes.find(node => node.type === reference.ThemeKeyReference);
    assert.equal(opened.props.open, true); opened.props.onClose();
    assert.equal(render().find(node => node.type === reference.ThemeKeyReference).props.open, false);
    assert.equal(nodes.filter(node => node.type === Tooltip).length, 3);
});
