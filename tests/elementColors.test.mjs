import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';

const { parseElementColors: parse, changeElementColors: change, prepareElementColorChange: prepare,
    ELEMENT_COLOR_KEYS: keys, ELEMENT_COLOR_AREAS: areas, ELEMENT_COLOR_DEFINITIONS: definitions } = load('features/appearance/domain/elementColors.ts');
const { createElementColorUpdater } = load('features/appearance/application/updateElementColors.ts');
const copy = value => structuredClone(value);
const cases = JSON.parse(readFileSync(new URL('./fixtures/elementColors.json', import.meta.url), 'utf8'));
const set = (key = 'mainTabs.background', color = '#AbCdEf') => ({ type: 'set', key, color });

test('renderer and native use the same finite color contract and adversarial cases', () => {
    for (const item of cases) assert.equal(parse(item.value) !== null, item.valid, item.name);
    assert.equal(keys.length, 33); assert.equal(new Set(keys).size, 33);
    for (const key of keys) assert.equal(parse({ version: 1, overrides: { [key]: '#123456' } }).overrides[key], '#123456');
    assert.ok(definitions.every(entry => entry.label && entry.areaLabel && areas.includes(entry.area) && entry.key.startsWith(`${entry.area}.`)));
    assert.ok(Object.isFrozen(keys)); assert.ok(Object.isFrozen(definitions));
    assert.ok(definitions.every(Object.isFrozen));
});

test('missing preferences inherit; valid data is detached and normalized without dropping unknown data', () => {
    assert.deepEqual(copy(parse(undefined)), { version: 1, overrides: {} });
    const original = { version: 1, overrides: { 'terminal.cursor': '#AaBbCc', 'mainTabs.background': '#ABCDEF' } };
    const before = copy(original); const parsed = parse(original);
    assert.deepEqual(Object.keys(parsed.overrides), ['mainTabs.background', 'terminal.cursor']);
    assert.equal(parsed.overrides['terminal.cursor'], '#aabbcc');
    parsed.overrides['terminal.cursor'] = '#000000'; assert.deepEqual(original, before);
    original.overrides['future.key'] = '#ffffff'; assert.equal(parse(original), null);
    assert.equal(original.overrides['future.key'], '#ffffff');
});

test('set, individual reset, area reset and reset all preserve unrelated overrides and source', () => {
    const original = parse({ version: 1, overrides: { 'mainTabs.background': '#123456', 'mainTabs.foreground': '#654321', 'terminal.cursor': '#000000' } });
    const before = copy(original);
    assert.equal(change(original, set()).overrides['mainTabs.background'], '#abcdef');
    assert.equal(change(original, { type: 'reset', key: 'mainTabs.background' }).overrides['mainTabs.background'], undefined);
    assert.deepEqual(copy(change(original, { type: 'reset-area', area: 'mainTabs' }).overrides), { 'terminal.cursor': '#000000' });
    assert.deepEqual(copy(change(original, { type: 'reset-all' }).overrides), {});
    assert.deepEqual(copy(original), before);
});

test('invalid intents cannot introduce arbitrary keys, alpha, CSS or unknown area resets', () => {
    for (const input of [null, {}, { type: 'future' }, set('__proto__'), set('unknown'), set('control.focus'),
        set('terminal.cursor', '#12345678'), { type: 'reset-area', area: 'Unknown' }, { type: 'reset', key: 'dialog.background' }]) {
        assert.equal(prepare(input), null);
        assert.equal(change(parse(undefined), input), null);
    }
});

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(save = async () => {}) {
    let state = { value: undefined, generation: 0, loading: false };
    const writes = []; const publications = [];
    const update = createElementColorUpdater({
        read: () => ({ ...state }),
        save: async (expected, value) => { writes.push(copy({ expected, value })); await save(expected, value); },
        publish: (before, value) => {
            if (state.loading || state.generation !== before.generation || state.value !== before.value) return false;
            state = { ...state, value }; publications.push(value); return true;
        },
    });
    return { update, writes, publications, read: () => state, replace: patch => { state = { ...state, ...patch }; } };
}

test('queued color changes use fresh acknowledged data and detached caller intent', async () => {
    const gate = deferred(); let calls = 0; const port = fixture(async () => { if (++calls === 1) await gate.promise; });
    const action = set(); const first = port.update(action); action.color = '#000000';
    const second = port.update(set('terminal.cursor', '#111111'));
    await Promise.resolve(); assert.equal(port.read().value, undefined); assert.equal(port.writes.length, 1);
    gate.resolve(); await Promise.all([first, second]);
    assert.deepEqual(port.writes[0].expected, { exists: false });
    assert.equal(port.writes[1].expected.value.overrides['mainTabs.background'], '#abcdef');
    assert.deepEqual(copy(port.read().value.overrides), { 'mainTabs.background': '#abcdef', 'terminal.cursor': '#111111' });
});

test('loading, unsupported formats and invalid edits never write or downgrade settings', async () => {
    const port = fixture(); port.replace({ loading: true });
    await assert.rejects(port.update(set()), /loading/);
    const unknown = { version: 99, overrides: { 'future': '#000000' } };
    port.replace({ loading: false, value: unknown });
    await assert.rejects(port.update({ type: 'reset-all' }), /unsupported/);
    await assert.rejects(port.update(set('bad')), /supported element/);
    assert.equal(port.read().value, unknown); assert.equal(port.writes.length, 0);
});

test('native failures leave state untouched, are retryable, and no-ops skip storage', async () => {
    let fail = true; const port = fixture(async () => { if (fail) throw Error('disk unavailable'); });
    await assert.rejects(port.update(set()), /disk unavailable/); assert.equal(port.read().value, undefined);
    fail = false; await port.update(set()); await port.update(set());
    assert.equal(port.writes.length, 2); assert.equal(port.publications.length, 1);
    await port.update({ type: 'reset-all' }); await port.update({ type: 'reset-all' });
    assert.equal(port.writes.length, 3);
});

test('a reload or same-generation replacement invalidates pending color acknowledgement', async () => {
    for (const replacement of [{ generation: 1 }, { value: { version: 1, overrides: {} } }, { loading: true }]) {
        const gate = deferred(); const port = fixture(() => gate.promise);
        const saving = port.update(set()); await Promise.resolve(); port.replace(replacement); gate.resolve();
        await assert.rejects(saving, /saved, but settings changed/);
        assert.equal(port.publications.length, 0);
    }
});

test('uncertain writes cannot turn a later reset into a false successful no-op', async () => {
    let disk; let loseReply = true;
    const port = fixture(async (expected, value) => {
        if (JSON.stringify(disk) === JSON.stringify(value)) return;
        if (JSON.stringify(disk) !== JSON.stringify(expected.exists ? expected.value : undefined)) throw Error('Reload settings');
        disk = copy(value);
        if (loseReply) { loseReply = false; throw Error('lost acknowledgement'); }
    });
    await assert.rejects(port.update(set()), /lost acknowledgement/);
    assert.equal(port.read().value, undefined);
    await assert.rejects(port.update({ type: 'reset-all' }), /Reload settings/);
    assert.equal(port.writes.length, 2, 'a reset must check disk after an uncertain write');
    assert.equal(disk.overrides['mainTabs.background'], '#abcdef');
    port.replace({ generation: 1, value: copy(disk) });
    await port.update({ type: 'reset-all' }); assert.deepEqual(disk.overrides, {});
    await port.update({ type: 'reset-all' }); assert.equal(port.writes.length, 3, 'confirmed no-ops are cheap again');
});
