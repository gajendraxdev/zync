import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function loadSource(path, dependencies = {}) {
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const context = { exports: {}, require: name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    } };
    runInNewContext(outputText, context);
    return context.exports;
}
const types = loadSource('src/lib/paneLayout/types.ts');
const query = loadSource('src/lib/paneLayout/query.ts', { './types': types });
const paneLayout = { ...types, ...query };
const inventory = loadSource('src/components/layout/featureTabInventory.ts', {
    '../../lib/paneLayout': paneLayout,
    '../../features/plugins/application/pluginPanelInventory': loadSource('src/features/plugins/application/pluginPanelInventory.ts'),
});
function feature(featureId, instanceId, paneId = `pane-${instanceId ?? featureId}`) {
    return { version: 1, activePaneId: paneId, root: { type: 'pane', id: paneId,
        content: { kind: 'feature', featureId, ...(instanceId && { instanceId }) } } };
}
function harness(initialGroups = {}, initial = {}) {
    const calls = { ensured: [], selected: [], missing: 0, created: 0 };
    const state = {
        paneLayouts: { local: initialGroups }, activePaneGroupOwner: { local: null }, contentPresentation: {},
        ensureFeaturePane: (scope, kind, id) => {
            calls.ensured.push({ scope, kind, id });
            state.paneLayouts[scope] = { ...state.paneLayouts[scope], [id]: feature(kind, id) };
        },
    };
    let options = { connectionId: 'local', view: 'terminal', pinnedFeatures: [], isActive: true, activeInstanceId: null, ...initial };
    const slots = [];
    let cursor = 0;
    let effects = [];
    const react = {
        useRef: initialValue => {
            const index = cursor++;
            return slots[index] ??= { current: initialValue };
        },
        useEffect: (effect, dependencies) => {
            const index = cursor++;
            const previous = slots[index];
            if (!previous || dependencies.some((value, position) => !Object.is(value, previous[position]))) effects.push(effect);
            slots[index] = dependencies;
        },
    };
    const { useFeaturePaneNavigation } = loadSource('src/components/layout/useFeaturePaneNavigation.ts', {
        react, '../../lib/paneLayout': paneLayout, './featureTabInventory': inventory,
    });
    const getState = () => state;
    const createInstanceId = () => `created-${++calls.created}`;
    const onSelectInstance = id => { calls.selected.push(id); options.activeInstanceId = id; };
    const onMissingView = () => { calls.missing++; options.view = 'terminal'; };
    const render = (patch = {}) => {
        options = { ...options, ...patch };
        cursor = 0;
        effects = [];
        useFeaturePaneNavigation({ ...options, groups: state.paneLayouts[options.connectionId],
            getState, createInstanceId, onSelectInstance, onMissingView });
        for (const effect of effects) effect();
    };
    return { state, calls, render, options: () => options };
}

test('initial feature view enrolls one canonical instance and repeated renders do not reensure it', () => {
    const subject = harness({}, { view: 'files' });
    subject.render();
    subject.render();
    subject.render({ isActive: false });
    subject.render({ isActive: true });
    assert.deepEqual(subject.calls.ensured, [{ scope: 'local', kind: 'files', id: 'created-1' }]);
    assert.equal(subject.options().activeInstanceId, 'created-1');
    assert.equal(subject.calls.missing, 0);
});

test('restored canonical instances satisfy initial navigation without creating or ensuring another', () => {
    const first = feature('files', 'first');
    const second = feature('files', 'second');
    const subject = harness({ first, second }, { view: 'files' });
    subject.state.activePaneGroupOwner.local = 'first';
    subject.render();
    assert.equal(subject.calls.ensured.length + subject.calls.created, 0);
    assert.equal(subject.options().activeInstanceId, 'first');
    assert.equal(subject.state.paneLayouts.local.first, first);
});

test('new feature navigation and newly added pins each enroll once with their intended identities', () => {
    const subject = harness();
    subject.render();
    subject.render({ view: 'dashboard' });
    subject.render({ pinnedFeatures: ['snippets'] });
    subject.render({ pinnedFeatures: ['snippets'] });
    assert.deepEqual(subject.calls.ensured, [
        { scope: 'local', kind: 'dashboard', id: 'created-1' },
        { scope: 'local', kind: 'snippets', id: 'pinned:snippets' },
    ]);
    assert.equal(subject.options().activeInstanceId, 'created-1', 'background pin enrollment must not replace the current feature selection');
});

test('same initial view and pin are one intent and unsupported/plugin kinds are ignored', () => {
    const subject = harness({}, { view: 'files', pinnedFeatures: ['files', 'plugin:owner:panel', 'unknown'] });
    subject.render();
    assert.deepEqual(subject.calls.ensured, [{ scope: 'local', kind: 'files', id: 'pinned:files' }]);
    assert.equal(subject.calls.created, 0);
});

test('header close followed by another feature, pin update and reactivation never resurrects the closed instance', () => {
    const subject = harness({}, { view: 'files' });
    subject.render();
    delete subject.state.paneLayouts.local['created-1'];
    subject.state.paneLayouts.local = {};
    subject.render();
    assert.equal(subject.options().view, 'terminal');
    assert.equal(subject.options().activeInstanceId, null);
    subject.render({ view: 'dashboard' });
    subject.render({ pinnedFeatures: ['snippets'] });
    subject.render({ isActive: false });
    subject.render({ isActive: true });
    assert.equal(subject.calls.ensured.filter(item => item.kind === 'files').length, 1);
    assert.ok(Object.values(subject.state.paneLayouts.local).every(canvas => canvas.root.content.featureId !== 'files'));
    assert.equal(subject.calls.missing, 1);
});

test('closing a pane while the workspace is inactive cannot recreate it on reactivation', () => {
    const subject = harness({ files: feature('files', 'files') }, { view: 'files', activeInstanceId: 'files' });
    subject.render();
    subject.render({ isActive: false });
    subject.state.paneLayouts.local = {};
    subject.render({ pinnedFeatures: ['dashboard'] });
    assert.equal(subject.calls.ensured.filter(item => item.kind === 'files').length, 0);
    subject.render({ isActive: true });
    assert.equal(subject.calls.ensured.filter(item => item.kind === 'files').length, 0);
    assert.equal(subject.options().view, 'terminal');
});

test('legacy and hidden canonical content count as existing for navigation and launch pins', () => {
    for (const legacy of [false, true]) {
        const canvas = feature('files', legacy ? undefined : 'hidden-files', 'saved-leaf');
        const subject = harness({ saved: canvas }, { view: 'files', pinnedFeatures: ['files'] });
        subject.state.contentPresentation = { local: { version: 3, items: {
            [JSON.stringify(['feature', 'files', legacy ? 'saved-leaf' : 'hidden-files'])]: { hidden: true },
        } } };
        subject.render();
        subject.render({ isActive: false });
        subject.render({ isActive: true });
        assert.equal(subject.calls.ensured.length + subject.calls.created + subject.calls.missing, 0);
        assert.equal(subject.state.paneLayouts.local.saved, canvas);
    }
});

test('valid exact selection wins over same-kind siblings and fallback uses the active canvas owner', () => {
    const first = feature('files', 'first');
    const second = feature('files', 'second');
    const subject = harness({ first, second }, { view: 'files', activeInstanceId: 'second' });
    subject.state.activePaneGroupOwner.local = 'first';
    subject.render();
    assert.equal(subject.options().activeInstanceId, 'second');
    assert.deepEqual(subject.calls.selected, []);
    subject.render({ activeInstanceId: 'stale' });
    assert.equal(subject.options().activeInstanceId, 'first');
    assert.deepEqual(subject.calls.selected, ['first']);
    assert.equal(subject.calls.ensured.length, 0);
});

test('scope changes and explicit re-pin create fresh intent while missing connection is inert', () => {
    const subject = harness({}, { view: 'terminal', pinnedFeatures: ['files'] });
    subject.render();
    subject.state.paneLayouts.local = {};
    subject.render({ pinnedFeatures: [] });
    subject.render({ pinnedFeatures: ['files'] });
    assert.equal(subject.calls.ensured.length, 2, 'a user re-pin is an explicit new open request');
    subject.render({ connectionId: undefined });
    assert.equal(subject.calls.ensured.length, 2);
    subject.state.paneLayouts.remote = {};
    subject.render({ connectionId: 'remote' });
    assert.deepEqual(subject.calls.ensured[2], { scope: 'remote', kind: 'files', id: 'pinned:files' });
});
