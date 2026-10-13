import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';
import { createElementColorStyle, ELEMENT_COLORS_CHANGED, TERMINAL_ELEMENT_COLORS_CHANGED } from '../.tmp-agent-tests/src/features/appearance/presentation/elementColorStyle.js';

const colors = load('features/appearance/domain/elementColors.ts');
const { buildElementColorRules: rules, terminalElementColorSignature: signature, ELEMENT_COLOR_BINDINGS: bindings } = load('features/appearance/presentation/elementColorBindings.ts');
const { opaqueCssColor, colorContrast } = load('features/appearance/domain/colorContrast.ts');
const value = overrides => ({ version: 1, overrides });

test('all supported colors bind only finite host selectors/color properties; default and unknown data emit nothing', () => {
    assert.deepEqual(Object.keys(bindings), [...colors.ELEMENT_COLOR_KEYS]);
    assert.equal(rules(undefined), ''); assert.equal(rules({ version: 2, overrides: {} }), '');
    for (const key of colors.ELEMENT_COLOR_KEYS) {
        const css = rules(value({ [key]: '#ABCDEF' }));
        assert.match(css, /:#abcdef;/); assert.match(css, /data-zync-color-protected/); assert.match(css, /role="dialog"/);
        assert.ok(['color', 'background-color', 'border-color'].includes(bindings[key].property) || bindings[key].property.startsWith('--zync-element-terminal-'));
        assert.doesNotMatch(css, /!important|position:|display:|height:|width:|z-index|url\(/);
    }
    assert.equal(rules(value({ 'mainTabs.background': 'red;display:none' })), '');
    assert.match(bindings['control.border'].selector, /:not\(:focus-visible\)/);
    assert.equal(signature(value({ 'sidebar.background': '#123456' })), signature(undefined));
});

function styleRoot() {
    const styles = []; const events = []; let created = 0;
    const root = {
        querySelector: () => ({ nonce: 'release-test-nonce' }),
        createElement: tag => { assert.equal(tag, 'style'); created++; return { nonce: '', dataset: {}, textContent: '', remove() { styles.splice(styles.indexOf(this), 1); } }; },
        head: { appendChild(style) { assert.equal(style.nonce, 'release-test-nonce'); assert.ok(style.textContent); styles.push(style); } },
        defaultView: { dispatchEvent: event => { events.push(event.type); } },
    };
    return { root, styles, events, created: () => created };
}

test('stylesheet owns one nonce-authorized node, suppresses no-ops, separates terminal refresh and disposes cleanly', () => {
    const fixture = styleRoot(); let refreshes = 0;
    const owner = createElementColorStyle(fixture.root, () => refreshes++);
    owner.update(undefined); assert.equal(fixture.created(), 0);
    const chrome = value({ 'mainTabs.background': '#123456' });
    owner.update(chrome); const retained = fixture.styles[0]; owner.update(structuredClone(chrome));
    assert.equal(fixture.created(), 1); assert.equal(refreshes, 0);
    assert.deepEqual(fixture.events, [ELEMENT_COLORS_CHANGED]);
    owner.update(value({ ...chrome.overrides, 'terminal.cursor': '#abcdef' }));
    assert.equal(fixture.styles[0], retained); assert.equal(refreshes, 1);
    assert.equal(fixture.events.at(-1), TERMINAL_ELEMENT_COLORS_CHANGED);
    owner.update({ version: 99, overrides: {} }); assert.equal(fixture.styles.length, 0); assert.equal(refreshes, 2);
    owner.update(chrome); owner.dispose(); owner.dispose(); owner.update(chrome);
    assert.equal(fixture.styles.length, 0); assert.equal(fixture.created(), 2);
});

test('contrast handles opaque sRGB endpoints/symmetry and refuses unknown/translucent colors', () => {
    assert.equal(colorContrast('#000000', '#ffffff'), 21); assert.equal(colorContrast('#123456', '#123456'), 1);
    assert.equal(colorContrast('#123456', '#ffffff'), colorContrast('#ffffff', '#123456'));
    assert.ok(colorContrast('#777777', '#ffffff') < 4.5);
    assert.equal(opaqueCssColor('rgb(255, 0, 16)'), '#ff0010'); assert.equal(opaqueCssColor('rgb(255 0 16 / 1)'), '#ff0010');
    assert.equal(opaqueCssColor('#AbC'), '#aabbcc');
    for (const input of ['rgba(255,0,0,0.4)', 'transparent', 'rgb(300,0,0)', 'rgb(255,,0,0)', 'rgb(255,0 0)', 'var(--color)', 'oklch(0.4 0.2 130)', 'url(secret)']) {
        assert.equal(opaqueCssColor(input), null); assert.equal(colorContrast(input, '#ffffff'), null);
    }
});

test('palette references depend on theme tokens, never mounted/hidden host contents or layout reads', () => {
    const source = readFileSync(new URL('../src/features/appearance/presentation/useElementColorSamples.ts', import.meta.url), 'utf8');
    const module = { exports: {} };
    const dependencies = { react: {}, '../domain/elementColors': colors, '../domain/colorContrast': { opaqueCssColor },
        './elementColorBindings': { ELEMENT_COLOR_BINDINGS: bindings }, './elementColorStyle': { ELEMENT_COLORS_CHANGED } };
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
        { module, exports: module.exports, require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
    const theme = { '--color-app-bg': '#18181b', '--color-app-text': '#ffffff', '--color-app-surface': '#334455' };
    const body = {}; let reads = 0;
    const root = { body, defaultView: { getComputedStyle: node => { assert.equal(node, body); reads++; return { getPropertyValue: key => theme[key] || '' }; } } };
    let references = module.exports.readElementColorSamples(root);
    assert.equal(reads, 1); assert.equal(references['mainTabs.background'], '#18181b');
    assert.equal(references['control.background'], '#334455'); assert.equal(references['terminal.selectionBackground'], null);
    theme['--color-app-bg'] = '#ffffff'; references = module.exports.readElementColorSamples(root);
    assert.equal(references['mainTabs.background'], '#ffffff');
    assert.doesNotMatch(source, /subtree:|childList:|getClientRects|querySelector|setInterval/);
});

/** Real theme adapter, isolated native store/cache and computed CSS; no PTY/native commands. */
function terminalTheme() {
    const css = { '--color-app-bg': '#18181b', '--color-app-text': '#ffffff', '--color-app-accent': '#aaaa00' };
    const cache = new Map(); const module = { exports: {} };
    const dependencies = {
        '../../lib/terminal/connectionIds.js': { LOCAL_TERMINAL_CONNECTION_ID: 'local' },
        '../../lib/themePayload.js': { resolveZyncThemeMode: () => 'dark' },
        '../../lib/terminal/terminalCache.js': { terminalCache: cache },
        '../../store/useAppStore': { useAppStore: { getState: () => ({ settings: {}, connections: [] }) } },
        '../../features/appearance/domain/elementColors': colors,
    };
    const source = readFileSync(new URL('../src/components/terminal/terminalTheme.ts', import.meta.url), 'utf8');
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
        { module, exports: module.exports, document: { body: {} }, getComputedStyle: () => ({ getPropertyValue: key => css[key] || '' }),
            require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
    return { css, cache, ...module.exports };
}

test('terminal overrides preserve ANSI, connection presets and transparency; cache refresh never fits/recreates resources', () => {
    const adapter = terminalTheme(); const opaque = { enabled: false, opacity: 1 };
    const before = adapter.resolveXtermTheme(null, undefined, opaque);
    Object.assign(adapter.css, { '--zync-element-terminal-background': '#123456', '--zync-element-terminal-foreground': '#abcdef',
        '--zync-element-terminal-cursor': '#654321', '--zync-element-terminal-selection': '#789abc' });
    const after = adapter.resolveXtermTheme(null, undefined, opaque);
    assert.equal(after.background, 'rgba(18, 52, 86, 1)'); assert.equal(after.foreground, '#abcdef');
    assert.equal(after.cursor, '#654321'); assert.equal(after.selectionBackground, '#789abc');
    for (const key of ['yellow', 'brightYellow', 'red', 'blue']) assert.equal(before[key], after[key]);
    const preset = adapter.resolveXtermTheme(null, 'red', opaque);
    assert.equal(preset.background, adapter.THEME_PRESETS.red.background); assert.equal(preset.cursor, adapter.THEME_PRESETS.red.cursor);
    assert.equal(preset.foreground, '#abcdef');
    assert.equal(adapter.resolveXtermTheme(null, undefined, { enabled: true, opacity: 0.7 }).background, 'rgba(0, 0, 0, 0)');
    assert.match(adapter.buildTerminalHostBackground(0.7), /--zync-element-terminal-background, var\(--color-app-bg\)/);
    let redraws = 0; const term = { rows: 24, options: {}, refresh(start, end) { assert.equal(start, 0); assert.equal(end, 23); redraws++; } };
    adapter.cache.set('retained', { term, connectionId: 'local' });
    adapter.refreshAllCachedTerminalThemes(); assert.equal(adapter.cache.get('retained').term, term); assert.equal(redraws, 1);
    assert.equal(term.options.theme.cursor, '#654321');
});
