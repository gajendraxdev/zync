import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadWorkspaceDomain as load } from './helpers/loadWorkspaceDomain.mjs';

const { CHROME_ACTIONS: actions, parseChromeActions: parse, changeChromeActions: change,
    prepareChromeActionChange: prepare, visibleChromeActions: visible } = load('features/workspace/domain/chromeActions.ts');
const { createChromeActionUpdater } = load('features/workspace/application/updateChromeActions.ts');
const cases = JSON.parse(readFileSync(new URL('./fixtures/chromeActions.json', import.meta.url), 'utf8'));
const copy = value => structuredClone(value);
const hide = (id = 'status.ai', value = true) => ({ type: 'hidden', id, value });

test('renderer/native shared cases reject unknown formats, duplicates, cross-area and mandatory hiding', () => {
    for (const item of cases) assert.equal(parse(item.value) !== null, item.valid, item.name);
    assert.equal(actions.length, 11); assert.equal(new Set(actions.map(action => action.id)).size, 11);
    assert.ok(Object.isFrozen(actions) && actions.every(Object.isFrozen));
    assert.deepEqual(copy(parse(undefined).workspaceToolbar.order), ['terminal.find', 'workspace.splits', 'workspace.sessionTools']);
    for (const action of actions.filter(action => !action.optional)) {
        assert.equal(prepare(hide(action.id)), null);
        assert.equal(change(parse(undefined), hide(action.id)), null);
    }
});

test('partial orders append known defaults and preserve the input; future values render defaults without mutation', () => {
    const original = { version: 1, workspaceToolbar: { order: ['workspace.sessionTools'], hidden: ['terminal.find'] }, statusBar: { order: [], hidden: [] } };
    const before = copy(original); const result = parse(original);
    assert.deepEqual(copy(result.workspaceToolbar.order), ['workspace.sessionTools', 'terminal.find', 'workspace.splits']);
    assert.deepEqual(copy(visible(original, 'workspaceToolbar')), ['workspace.sessionTools', 'workspace.splits']);
    result.workspaceToolbar.order.reverse(); assert.deepEqual(original, before);
    const future = { version: 99, secretFutureChoice: 'opaque' };
    assert.deepEqual(copy(visible(future, 'statusBar')), copy(parse(undefined).statusBar.order));
    assert.deepEqual(future, { version: 99, secretFutureChoice: 'opaque' });
});

test('same-area movement/hiding/reset are detached and retain the other area and dormant choices', () => {
    const original = change(parse(undefined), hide('terminal.find'));
    const hidden = change(original, hide());
    const moved = change(hidden, { type: 'move', id: 'workspace.sessionTools', targetId: 'terminal.find' });
    assert.deepEqual(copy(moved.workspaceToolbar.order), ['workspace.sessionTools', 'terminal.find', 'workspace.splits']);
    assert.deepEqual(copy(moved.workspaceToolbar.hidden), ['terminal.find']);
    assert.deepEqual(copy(moved.statusBar.hidden), ['status.ai']);
    const reset = change(moved, { type: 'reset', area: 'workspaceToolbar' });
    assert.deepEqual(copy(reset.workspaceToolbar), copy(parse(undefined).workspaceToolbar));
    assert.deepEqual(copy(reset.statusBar), copy(moved.statusBar));
    assert.deepEqual(copy(original.statusBar.hidden), []);
    for (const bad of [null, {}, { type: 'move', id: 'status.ai', targetId: 'terminal.find' },
        { type: 'reset', area: '__proto__' }, hide('__proto__'), hide('status.ai', 'true'), { type: 'script', id: 'status.ai' }]) {
        assert.equal(prepare(bad), null); assert.equal(change(original, bad), null);
    }
});

function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(save = async () => {}) {
    let state = { value: undefined, generation: 0, loading: false };
    const writes = [];
    const update = createChromeActionUpdater({
        read: () => ({ ...state }),
        save: async (expected, value) => { writes.push(copy({ expected, value })); await save(expected, value); },
        publish: (before, value) => {
            if (state.loading || state.generation !== before.generation || state.value !== before.value) return false;
            state = { ...state, value }; return true;
        },
    });
    return { update, writes, read: () => state, replace: patch => { state = { ...state, ...patch }; } };
}

test('queued intents are copied and published only after acknowledgement using fresh preferences', async () => {
    const gate = deferred(); let count = 0;
    const port = fixture(async () => { if (++count === 1) await gate.promise; });
    const intent = hide(); const first = port.update(intent); intent.id = 'status.updates';
    const next = port.update(hide('terminal.find'));
    await Promise.resolve(); assert.equal(port.read().value, undefined); assert.equal(port.writes.length, 1);
    gate.resolve(); await Promise.all([first, next]);
    assert.deepEqual(port.writes[0].expected, { exists: false });
    assert.deepEqual(port.writes[1].expected.value.statusBar.hidden, ['status.ai']);
    assert.deepEqual(copy(port.read().value.workspaceToolbar.hidden), ['terminal.find']);
    assert.deepEqual(copy(port.read().value.statusBar.hidden), ['status.ai']);
    await port.update(hide()); assert.equal(port.writes.length, 2, 'Known no-op avoids another write');
});

test('load/future boundaries never write and pending reload cannot publish stale choices', async () => {
    const gate = deferred(); const port = fixture(() => gate.promise);
    port.replace({ loading: true }); await assert.rejects(port.update(hide()), /loading/);
    port.replace({ loading: false, value: { version: 99 } });
    await assert.rejects(port.update(hide()), /unsupported/);
    await assert.rejects(port.update(hide('status.updates')), /supported/); assert.equal(port.writes.length, 0);
    port.replace({ value: undefined }); const save = port.update(hide()); await Promise.resolve();
    port.replace({ generation: 1 }); gate.resolve(); await assert.rejects(save, /settings changed/);
    assert.equal(port.read().value, undefined);
});

test('lost acknowledgements preserve local state and force apparent reset/no-op to verify disk', async () => {
    let fail = true; const port = fixture(async () => { if (fail) throw Error('lost reply'); });
    await assert.rejects(port.update(hide()), /lost reply/); assert.equal(port.read().value, undefined);
    fail = false; await port.update({ type: 'reset', area: 'statusBar' });
    assert.equal(port.writes.length, 2); assert.deepEqual(copy(port.read().value.statusBar.hidden), []);
    await port.update(hide()); assert.deepEqual(copy(port.read().value.statusBar.hidden), ['status.ai']);
});
