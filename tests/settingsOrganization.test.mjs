import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Children, isValidElement } from 'react';
import ts from 'typescript';
import { SETTINGS_SECTIONS } from '../.tmp-agent-tests/src/components/settings/SettingsNavigation.js';

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const elements = node => isValidElement(node) ? [node, ...Children.toArray(node.props.children).flatMap(elements)] : [];
const stub = () => null;
function load(path, boundaries) {
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(read(path), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, { module, exports: module.exports,
        require: name => Object.hasOwn(boundaries, name) ? boundaries[name] : require(name) });
    return module.exports;
}

test('settings registry and transient store destinations agree; Status Bar is not a separate page', () => {
    const file = ts.createSourceFile('settingsSlice.ts', read('store/settingsSlice.ts'), ts.ScriptTarget.Latest, true);
    const id = file.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'SettingsTabId');
    assert.deepEqual(id.type.types.map(node => node.literal.text), SETTINGS_SECTIONS.map(section => section.key));
    assert.equal(SETTINGS_SECTIONS.find(section => section.key === 'layout').label, 'Layout & Navigation');
    assert.ok(!SETTINGS_SECTIONS.some(section => section.key === 'statusBar'));
});

test('Layout & Navigation composes existing owners and delegates only the requested close preference', async () => {
    const saveNavigation = async () => {};
    const saveChrome = async () => {};
    const saves = [];
    const saveStatus = async () => {};
    const NavigationSection = stub, WorkspaceTabsSection = () => null, ChromeActionsSection = () => null, StatusBarSection = () => null;
    const { LayoutNavigationTab } = load('components/settings/tabs/LayoutNavigationTab.tsx', {
        '../../../store/useAppStore': { useAppStore: selector => selector({
            updateWorkspaceNavigation: saveNavigation, updateChromeActions: saveChrome, isReloadingSettings: true,
        }) },
        './layout/NavigationSection': { NavigationSection }, './layout/WorkspaceTabsSection': { WorkspaceTabsSection },
        './layout/ChromeActionsSection': { ChromeActionsSection }, './layout/StatusBarSection': { StatusBarSection },
    });
    const settings = { workspaceNavigation: { version: 1 }, mainTabCloseButton: 'hidden', chromeActions: { version: 1 } };
    const nodes = elements(LayoutNavigationTab({ settings, updateSettings: async patch => saves.push({ ...patch }), updateStatusBarSettings: saveStatus }));
    const navigation = nodes.find(node => node.type === NavigationSection);
    assert.equal(navigation.props.value, settings.workspaceNavigation);
    assert.equal(navigation.props.onChange, saveNavigation);
    const chrome = nodes.find(node => node.type === ChromeActionsSection);
    assert.equal(chrome.props.area, 'workspaceToolbar');
    assert.equal(chrome.props.value, settings.chromeActions);
    assert.equal(chrome.props.loading, true);
    assert.equal(chrome.props.onChange, saveChrome);
    const status = nodes.find(node => node.type === StatusBarSection);
    assert.equal(status.props.settings, settings);
    assert.equal(status.props.updateStatusBarSettings, saveStatus);
    const tabs = nodes.find(node => node.type === WorkspaceTabsSection);
    assert.equal(tabs.props.closeButtonMode, 'hidden');
    assert.deepEqual(saves, [], 'opening must not write or reset preferences');
    tabs.props.onCloseButtonModeChange('active'); await Promise.resolve();
    assert.deepEqual(saves, [{ mainTabCloseButton: 'active' }]);
});

/** Isolate commit bookkeeping, not React scheduling; real event behavior has a browser fixture. */
function terminalHarness() {
    let draft, ref;
    const TerminalTypographySection = stub, TerminalViewportSection = () => null;
    const { TerminalAppearanceSection } = load('components/settings/tabs/terminal/TerminalAppearanceSection.tsx', {
        react: { useState: initial => [draft ??= initial, value => { draft = value; }],
            useRef: initial => ref ??= { current: initial }, useEffect() {} },
        './TerminalTypographySection': { TerminalTypographySection }, './TerminalViewportSection': { TerminalViewportSection },
    });
    const saves = [], terminalSaves = [];
    const props = { settings: { windowOpacity: 1, terminal: {} }, terminalFontDraft: 'draft', isWindows: true,
        setTerminalFontDraft() {}, updateSettings: async patch => saves.push({ ...patch }),
        updateTerminalSettings: async patch => terminalSaves.push({ ...patch }) };
    const render = () => elements(TerminalAppearanceSection(props));
    const viewport = () => render().find(node => node.type === TerminalViewportSection).props;
    return { props, saves, terminalSaves, render, viewport, TerminalTypographySection };
}

test('moved terminal opacity remains draft-only, clamps and commits once across pointer/key/blur', async () => {
    const fixture = terminalHarness();
    fixture.viewport().onCommitTerminalOpacity();
    assert.deepEqual(fixture.saves, []);
    fixture.viewport().onDraftOpacityPercentChange(67);
    assert.deepEqual(fixture.saves, []);
    for (let index = 0; index < 3; index++) fixture.viewport().onCommitTerminalOpacity();
    await Promise.resolve(); assert.deepEqual(fixture.saves, [{ windowOpacity: 0.67 }]);
    fixture.viewport().onDraftOpacityPercentChange(15); fixture.viewport().onCommitTerminalOpacity();
    await Promise.resolve(); assert.deepEqual(fixture.saves.at(-1), { windowOpacity: 0.3 });
});

test('terminal font/cursor/transparency delegates retain their existing persistence fields', async () => {
    const fixture = terminalHarness();
    const typography = fixture.render().find(node => node.type === fixture.TerminalTypographySection).props;
    assert.equal(typography.onTerminalFontDraftChange, fixture.props.setTerminalFontDraft);
    assert.equal(typography.terminalFontDraft, 'draft'); assert.equal(typography.isWindows, true);
    typography.onUpdateTerminalSettings({ fontFamily: 'mono' });
    fixture.viewport().onCursorStyleChange('bar'); fixture.viewport().onTransparencyChange(true);
    await Promise.resolve();
    assert.deepEqual(fixture.terminalSaves, [{ fontFamily: 'mono' }, { cursorStyle: 'bar' }]);
    assert.deepEqual(fixture.saves, [{ enableVibrancy: true }]);
});

test('Appearance owns only visual controls; Terminal mounts its visuals without an Appearance scope switch', () => {
    const imports = path => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        .statements.filter(ts.isImportDeclaration).map(node => node.moduleSpecifier.text);
    const appearance = imports('components/settings/tabs/AppearanceTab.tsx');
    assert.ok(appearance.some(path => path.endsWith('/AppearanceElementColorsSection')));
    assert.ok(!appearance.some(path => /layout\/|terminal\/|SegmentedControl/.test(path)));
    const terminal = imports('components/settings/tabs/TerminalTab.tsx');
    assert.ok(terminal.some(path => path.endsWith('/TerminalAppearanceSection')));
    assert.doesNotMatch(read('components/settings/SettingsModal.tsx'), /appearanceView|StatusBarTab|onOpenAppearanceTerminal/);
});

test('Theme files follows all color and interface editors at the bottom of Appearance', () => {
    const file = ts.createSourceFile('AppearanceTab.tsx', read('components/settings/tabs/AppearanceTab.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const sections = [];
    const visit = node => {
        if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(file).startsWith('Appearance')) sections.push(node.tagName.getText(file));
        ts.forEachChild(node, visit);
    };
    visit(file);
    assert.equal(sections.at(-1), 'AppearanceThemeFilesSection');
    assert.equal(sections.at(-2), 'AppearanceElementColorsSection');
    assert.equal(sections.filter(name => name === 'AppearanceThemeFilesSection').length, 1);
});
