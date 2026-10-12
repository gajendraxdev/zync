import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Source-only pure-domain tests never write or depend on shared compiled output.
function loadSource(path, dependencies = {}) {
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../src/lib/paneLayout/${path}.ts`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const context = { exports: {}, require: name => {
        assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency: ${name}`);
        return dependencies[name];
    } };
    runInNewContext(outputText, context);
    return context.exports;
}
const types = loadSource('types');
const query = loadSource('query', { './types': types });
const identity = loadSource('contentIdentity');
const { projectVisiblePaneLayout } = loadSource('visibility', { './contentIdentity': identity, './query': query });
const { canSplit } = loadSource('ops', { './ids': {}, './query': query, './dock': {}, './intro': {}, './types': types });
const leaf = (id, content) => ({ type: 'pane', id, content });
const shell = leaf('shell-pane', { kind: 'term', termId: 'shell' });
const files = leaf('files-pane', { kind: 'feature', featureId: 'files', instanceId: 'files-one' });
const plugin = leaf('plugin-pane', { kind: 'plugin', pluginId: 'owner:panel', instanceId: 'plugin-one' });
const dashboard = leaf('dashboard-pane', { kind: 'feature', featureId: 'dashboard', instanceId: 'dashboard-one' });
const branch = (id, first, second, direction = 'horizontal', sizes = [0.4, 0.6]) => ({ type: 'split', id, direction, sizes, children: [first, second] });
const layout = (root, activePaneId = query.firstLeaf(root).id) => ({ version: 1, root, activePaneId });
const key = pane => identity.paneContentKey(pane.content, pane.id);
const hide = (...panes) => new Set(panes.map(key));
function freeze(value) {
    for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
    return Object.freeze(value);
}

test('empty or unrelated hidden sets preserve every layout and node reference', () => {
    const canonical = freeze(layout(branch('root', shell, files)));
    for (const hidden of [new Set(), new Set(['stale-content', key(plugin)])]) {
        assert.equal(projectVisiblePaneLayout(canonical, hidden), canonical);
        assert.equal(canonical.root.children[0], shell);
        assert.equal(canonical.root.children[1], files);
    }
});

test('one pane projects unchanged when visible and null only for its exact hidden identity', () => {
    const canonical = freeze(layout(plugin));
    assert.equal(projectVisiblePaneLayout(canonical, hide(files)), canonical);
    assert.equal(projectVisiblePaneLayout(canonical, hide(plugin)), null);
    assert.equal(canonical.root, plugin);
});

test('hiding either sibling collapses its branch onto the original surviving leaf', () => {
    const canonical = freeze(layout(branch('root', shell, files), shell.id));
    const onlyFiles = projectVisiblePaneLayout(canonical, hide(shell));
    assert.equal(onlyFiles.root, files);
    assert.equal(onlyFiles.activePaneId, files.id);
    const onlyShell = projectVisiblePaneLayout(canonical, hide(files));
    assert.equal(onlyShell.root, shell);
    assert.equal(onlyShell.activePaneId, shell.id);
    assert.equal(onlyFiles.version, canonical.version);
});

test('nested projection shares unchanged branches and preserves surviving split IDs and size tuples', () => {
    const left = branch('left', shell, files, 'vertical', [0.25, 0.75]);
    const right = branch('right', plugin, dashboard, 'vertical', [0.7, 0.3]);
    const canonical = freeze(layout(branch('root', left, right, 'horizontal', [0.35, 0.65]), plugin.id));
    const projected = projectVisiblePaneLayout(canonical, hide(files));
    assert.notEqual(projected.root, canonical.root);
    assert.equal(projected.root.id, canonical.root.id);
    assert.equal(projected.root.direction, canonical.root.direction);
    assert.equal(projected.root.sizes, canonical.root.sizes);
    assert.equal(projected.root.children[0], shell);
    assert.equal(projected.root.children[1], right);
    assert.equal(projected.root.children[1].sizes, right.sizes);
    assert.equal(projected.activePaneId, plugin.id);
    assert.equal(projected.root.children[1].children[0].content, plugin.content);
});

test('hiding a whole branch promotes the untouched surviving branch and deterministically repairs projected focus', () => {
    const left = branch('left', shell, files);
    const right = branch('right', plugin, dashboard);
    const canonical = freeze(layout(branch('root', left, right), files.id));
    const projected = projectVisiblePaneLayout(canonical, hide(shell, files));
    assert.equal(projected.root, right);
    assert.equal(projected.activePaneId, plugin.id);
    assert.equal(canonical.activePaneId, files.id, 'canonical focus is not rewritten');
});

test('all-hidden returns null without mutating the canonical tree or caller hidden set', () => {
    const canonical = freeze(layout(branch('root', shell, files), files.id));
    const snapshot = JSON.stringify(canonical);
    const hidden = hide(shell, files);
    const idsBefore = [...hidden];
    assert.equal(projectVisiblePaneLayout(canonical, hidden), null);
    assert.equal(JSON.stringify(canonical), snapshot);
    assert.deepEqual([...hidden], idsBefore);
});

test('mixed legacy feature/plugin identities hide only exact leaf keys, never all content of the same kind', () => {
    const legacyFeatureA = leaf('legacy-feature-a', { kind: 'feature', featureId: 'files' });
    const legacyFeatureB = leaf('legacy-feature-b', { kind: 'feature', featureId: 'files' });
    const legacyPluginA = leaf('legacy-plugin-a', { kind: 'plugin', pluginId: 'same:panel' });
    const legacyPluginB = leaf('legacy-plugin-b', { kind: 'plugin', pluginId: 'same:panel' });
    const canonical = freeze(layout(branch('root', branch('left', legacyFeatureA, legacyPluginA), branch('right', legacyFeatureB, legacyPluginB)), legacyPluginA.id));
    const projected = projectVisiblePaneLayout(canonical, hide(legacyFeatureA, legacyPluginA));
    assert.deepEqual(Array.from(query.collectLeaves(projected.root), pane => pane.id), [legacyFeatureB.id, legacyPluginB.id]);
    assert.equal(projected.activePaneId, legacyFeatureB.id);
    assert.equal(projected.root.children[0], legacyFeatureB);
    assert.equal(projected.root.children[1], legacyPluginB);
    assert.ok(query.collectLeaves(canonical.root).every(pane => pane.content.instanceId === undefined));
});

test('hiding at the four-pane cap changes geometry only; reveal recovers the original tree and saved focus', () => {
    const canonical = freeze(layout(branch('root', branch('left', shell, files), branch('right', plugin, dashboard)), dashboard.id));
    const snapshot = JSON.stringify(canonical);
    assert.equal(query.leafCount(canonical.root), types.MAX_VISIBLE_PANES);
    assert.equal(canSplit(canonical), false);
    const projected = projectVisiblePaneLayout(canonical, hide(files, dashboard));
    assert.equal(query.leafCount(projected.root), 2);
    assert.equal(projected.activePaneId, shell.id);
    assert.equal(canSplit(canonical), false, 'capacity must still be checked against the canonical layout');
    assert.equal(JSON.stringify(canonical), snapshot);
    const revealed = projectVisiblePaneLayout(canonical, new Set());
    assert.equal(revealed, canonical);
    assert.equal(revealed.activePaneId, dashboard.id);
    assert.equal(query.leafCount(revealed.root), 4);
});
