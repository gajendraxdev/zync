import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';

const { validateThemeDocument: validate, parseThemeDocument: parse, readThemeJson: read, writeThemeJson: write,
    themeSettingsSnapshot: snapshot, sameThemeSettings, THEME_FILE_MAX_BYTES } = load('features/appearance/domain/themeDocument.ts');
const { createThemeImportUpdater } = load('features/appearance/application/importTheme.ts');
const { captureThemeDocument, themePreviewStyle, themeContrastWarnings, buildCustomThemeRules } = load('features/appearance/presentation/themeDocumentPresentation.ts');
const fixture = JSON.parse(readFileSync(new URL('./fixtures/themeDocument.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const theme = () => copy(fixture.theme);
const defer = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('shared native/frontend cases reject arbitrary CSS, metadata, future formats and unknown semantic keys', () => {
    assert.ok(parse(theme()));
    for (const invalid of fixture.invalid) {
        const value = theme(); let parent = value;
        for (const key of invalid.path.slice(0, -1)) parent = parent[key];
        Object.defineProperty(parent, invalid.path.at(-1), { value: invalid.value, enumerable: true, configurable: true });
        assert.equal(parse(value), null, invalid.path.join('.'));
    }
    for (const input of [null, [], 'theme', {}, { ...theme(), elements: undefined }, { ...theme(), name: 'a'.repeat(81) }]) assert.equal(parse(input), null);
    for (const key of Object.keys(theme())) { const value = theme(); delete value[key]; assert.equal(parse(value), null, key); }
    for (const key of Object.keys(theme().palette)) { const value = theme(); delete value.palette[key]; assert.equal(parse(value), null, key); }
});

test('JSON import/export is detached, canonical, round-trippable, BOM tolerant and UTF-8 bounded', () => {
    const original = theme(); const result = validate(original);
    assert.equal(result.elements.overrides['terminal.cursor'], '#abcdef');
    result.palette.text = '#000000'; assert.equal(original.palette.text, '#f0f4ff');
    const serialized = write(original);
    assert.equal(write(read(serialized)), serialized); assert.equal(write(read(`\uFEFF${serialized}`)), serialized);
    assert.throws(() => read('{broken'), /Invalid JSON/);
    assert.throws(() => read(' '.repeat(THEME_FILE_MAX_BYTES + 1)), /64 KB/);
    assert.throws(() => read('é'.repeat(THEME_FILE_MAX_BYTES / 2 + 1)), /64 KB/);
    assert.throws(() => read(serialized.replace('"accent":', '"__proto__":')), /Palette/);
});

test('preview/export share the fixed palette; export excludes fonts, hosts, layout and plugin code', () => {
    const current = validate(theme()); const vars = themePreviewStyle(current);
    const root = { body: {}, defaultView: { getComputedStyle: () => ({ getPropertyValue: key => vars[key] }) } };
    const exported = captureThemeDocument(root, 'light', current.elements, 'Edited');
    assert.deepEqual(Object.keys(exported), ['format', 'version', 'name', 'mode', 'palette', 'elements']);
    assert.equal(exported.mode, 'light'); assert.equal(exported.palette.accent, '#60a5fa');
    assert.equal(buildCustomThemeRules({ ...current, script: 'bad' }), '');
    assert.match(buildCustomThemeRules(current), /body\[data-theme="custom"\]/);
    assert.doesNotMatch(buildCustomThemeRules(current), /url\(|!important|display:|script/);
    assert.equal(themeContrastWarnings(current).length, 0);
    current.palette.text = current.palette.background;
    assert.ok(themeContrastWarnings(current).some(item => item.startsWith('Terminal:')));
    assert.throws(() => captureThemeDocument(root, 'dark', { version: 9 }, 'Bad'), /unsupported/);
});

test('name normalization follows the shared finite Unicode contract without cross-runtime drift', () => {
    for (const sample of fixture.names) assert.equal(validate({ ...theme(), name: sample.input }).name, sample.output);
    const whitespace = JSON.parse(readFileSync(new URL('../src/features/appearance/domain/themeNameWhitespace.json', import.meta.url), 'utf8'));
    for (const edge of whitespace) assert.equal(validate({ ...theme(), name: `${edge}Ocean${edge}` }).name, 'Ocean');
});

test('import warnings cover pane headers, both active tab states, hover and opaque selection', () => {
    const pairs = load('features/appearance/presentation/elementColorContrast.ts').ELEMENT_TEXT_CONTRAST_PAIRS;
    for (const pair of pairs) {
        const value = theme(); value.elements.overrides = { [pair.foreground]: '#000000', [pair.background]: '#000000' };
        assert.ok(themeContrastWarnings(value).some(warning => warning.startsWith(`${pair.label}:`)), pair.label);
    }
    assert.equal(pairs.length, 13);
    assert.equal(themeContrastWarnings(theme()).length, 0, 'translucent inherited selection is not falsely audited');
});

function harness(save = async () => {}) {
    let state = { loading: false, generation: 0, value: snapshot({ theme: 'dark' }) };
    const writes = []; let publications = 0;
    const updater = createThemeImportUpdater({ read: () => state,
        save: async (expected, value) => { writes.push(copy({ expected, value })); await save(expected, value); },
        publish: (before, value) => {
            if (state.loading || before.generation !== state.generation || !sameThemeSettings(state.value, before.value)) return false;
            state = { ...state, value }; publications++; return true;
        },
    });
    return { updater, writes, state: () => state, set: patch => { state = { ...state, ...patch }; }, publications: () => publications };
}

test('apply publishes all four fields only after acknowledgement and copies the caller intent', async () => {
    const gate = defer(); const h = harness(() => gate.promise); const input = theme();
    const request = h.updater(input); input.palette.text = '#000000'; await Promise.resolve();
    assert.equal(h.state().value.theme, 'dark'); assert.equal(h.publications(), 0);
    gate.resolve(); await request;
    assert.equal(h.publications(), 1); assert.equal(h.state().value.theme, 'custom');
    assert.equal(h.state().value.accentColor, null); assert.equal(h.state().value.customTheme.palette.text, '#f0f4ff');
    assert.equal(h.state().value.elementColors.overrides['terminal.cursor'], '#abcdef');
    await h.updater(theme()); assert.equal(h.writes.length, 1);
});

test('invalid/future/loading settings fail before saving; failed saves do not change active colors', async () => {
    const h = harness(async () => { throw new Error('disk full'); });
    await assert.rejects(h.updater({ ...theme(), mode: 'system' }), /Invalid/); assert.equal(h.writes.length, 0);
    h.set({ loading: true }); await assert.rejects(h.updater(theme()), /loading/); assert.equal(h.writes.length, 0);
    h.set({ loading: false, value: { ...h.state().value, customTheme: { version: 99 } } });
    await assert.rejects(h.updater(theme()), /unsupported/); assert.equal(h.writes.length, 0);
    h.set({ value: snapshot({ theme: 'dark' }) }); await assert.rejects(h.updater(theme()), /disk full/);
    assert.equal(h.state().value.theme, 'dark'); assert.equal(h.publications(), 0);
});

test('reload or newer theme choices cannot be overwritten by a late acknowledgement', async () => {
    for (const race of ['reload', 'palette']) {
        const gate = defer(); const h = harness(() => gate.promise);
        const applying = h.updater(theme()); await Promise.resolve();
        if (race === 'reload') h.set({ generation: 1 });
        else h.set({ value: snapshot({ theme: 'light', elementColors: { version: 1, overrides: {} } }) });
        gate.resolve(); await assert.rejects(applying, /settings changed/); assert.equal(h.publications(), 0);
    }
});
