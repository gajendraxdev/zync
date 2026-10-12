import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const cache = new Map();
function load(relative) {
    const file = relative.startsWith('src/') ? fileURLToPath(new URL(`../${relative}`, import.meta.url)) : relative;
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, { module, exports: module.exports,
        require: name => {
            if (!name.startsWith('.')) return require(name);
            const base = path.resolve(path.dirname(file), name.replace(/\.js$/, ''));
            const found = [base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(existsSync);
            assert.ok(found, name); return load(found);
        } });
    return module.exports;
}
const domain = load('src/lib/paneLayout/regions.ts');
const { collectLeaves } = load('src/lib/paneLayout/query.ts');
const { paneContentKey } = load('src/lib/paneLayout/contentIdentity.ts');
const { paneRegionSurfaces } = load('src/components/workspace/paneRegionSurfaces.ts');
const { PaneRegionFrame } = load('src/components/workspace/PaneRegionFrame.tsx');
const { WorkspaceDockingFrame } = load('src/components/workspace/WorkspaceDockingFrame.tsx');
const { RegionDropGuides } = load('src/components/workspace/RegionDropGuides.tsx');

test('subtle region hints retain explicit hit targets without bright borders or shadows', () => {
    const html = renderToStaticMarkup(React.createElement(RegionDropGuides, {
        destinations: ['primary-sidebar', 'secondary-sidebar', 'bottom-panel'], occupied: new Set(['workspace']),
    }));
    assert.match(html, /workspace-drop-guides/);
    assert.equal((html.match(/data-workspace-drop-region=/g) ?? []).length, 3);
    assert.match(html, /bg-app-panel\/60/);
    assert.doesNotMatch(html, /border-2|border-app-accent|shadow-lg/);
    for (const label of ['Dock left', 'Dock right', 'Dock bottom', 'Stays visible across tabs']) assert.ok(html.includes(label));
});
const { projectWorkspaceDocking } = load('src/features/workspace/domain/dockingProjection.ts');
const key = leaf => paneContentKey(leaf.content, leaf.id);
const leaves = [
    { type: 'pane', id: 'term-pane', content: { kind: 'term', termId: 'one' } },
    { type: 'pane', id: 'files-pane', content: { kind: 'feature', featureId: 'files', instanceId: 'two' } },
    { type: 'pane', id: 'plugin-pane', content: { kind: 'plugin', pluginId: 'sample', instanceId: 'three' } },
    { type: 'pane', id: 'other-plugin-pane', content: { kind: 'plugin', pluginId: 'sample', instanceId: 'four' } },
];
const pair = (id, first, second) => ({ type: 'split', id, direction: 'horizontal', sizes: [0.4, 0.6], children: [first, second] });
const layout = { version: 1, activePaneId: leaves[2].id, root: pair('outer', pair('left', ...leaves.slice(0, 2)), pair('right', ...leaves.slice(2))) };
const empty = new Set();
const placements = new Map(leaves.map((leaf, index) => [key(leaf), domain.PANE_REGIONS[index]]));

test('connection frame keeps separate real canvas pieces and an always-reachable center fallback', () => {
    const canvases = leaves.slice(0, 2).map(leaf => ({ owner: leaf.id, layout: { version: 1, activePaneId: leaf.id, root: leaf } }));
    const allBottom = new Map(leaves.slice(0, 2).map(leaf => [key(leaf), 'bottom-panel']));
    const projection = projectWorkspaceDocking(canvases, allBottom, empty, null).value;
    const rendered = [];
    const markup = renderToStaticMarkup(React.createElement(WorkspaceDockingFrame, {
        projection,
        emptyWorkspace: React.createElement('button', { type: 'button' }, 'Recover workspace'),
        renderAllocation: (allocation, region) => {
            rendered.push({ allocation, region });
            return React.createElement('span', null, allocation.owner);
        },
    }));
    assert.match(markup, /grid-template-columns:repeat\(2, minmax\(0, 1fr\)\)/);
    assert.equal((markup.match(/data-region-owner=/g) ?? []).length, 2);
    assert.match(markup, /Recover workspace/);
    assert.equal(rendered.length, 2);
    for (const [index, item] of rendered.entries()) {
        assert.equal(item.allocation.canonical, canvases[index].layout);
        assert.equal(item.region, 'bottom-panel');
    }
});

test('default projection shares canonical geometry and has no peripheral allocation', () => {
    const regions = domain.projectPaneRegions(layout, new Map(), empty);
    assert.equal(regions.workspace, layout);
    for (const region of domain.PANE_REGIONS.slice(1)) assert.equal(regions[region], null);
});

test('a move changes allocation only; IDs, canonical ratios and resource references remain intact', () => {
    const before = JSON.stringify(layout); const original = new Map();
    const moved = domain.movePaneRegion(layout, original, key(leaves[2]), 'bottom-panel', domain.PANE_REGIONS);
    assert.equal(moved.ok, true); assert.equal(original.size, 0);
    const regions = domain.projectPaneRegions(layout, moved.assignments, empty);
    assert.equal(regions['bottom-panel'].root, leaves[2]);
    assert.equal(regions.workspace.root.children[0], layout.root.children[0]);
    assert.equal(regions.workspace.root.sizes, layout.root.sizes);
    assert.equal(JSON.stringify(layout), before);
    const restored = domain.movePaneRegion(layout, moved.assignments, key(leaves[2]), 'workspace', domain.PANE_REGIONS);
    assert.equal(restored.assignments.size, 0);
    assert.equal(domain.projectPaneRegions(layout, restored.assignments, empty).workspace, layout);
});

test('no-op moves preserve reference and unsupported or stale operations are refused', () => {
    const same = domain.movePaneRegion(layout, placements, key(leaves[2]), 'secondary-sidebar', domain.PANE_REGIONS);
    assert.equal(same.assignments, placements);
    for (const [id, where, allowed, reason] of [
        ['other-workspace-instance', 'bottom-panel', domain.PANE_REGIONS, 'missing-content'],
        [key(leaves[0]), 'bottom-panel', ['workspace'], 'unsupported-location'],
        [key(leaves[0]), 'floating', domain.PANE_REGIONS, 'unsupported-location'],
    ]) {
        const result = domain.movePaneRegion(layout, placements, id, where, allowed);
        assert.equal(result.ok, false); assert.equal(result.reason, reason);
    }
});

test('ambiguous content and over-cap canvases cannot be moved', () => {
    const duplicate = { ...leaves[0], id: 'duplicate' };
    const ambiguous = { ...layout, root: pair('ambiguous', leaves[0], duplicate) };
    assert.equal(domain.movePaneRegion(ambiguous, new Map(), key(leaves[0]), 'bottom-panel', domain.PANE_REGIONS).reason, 'missing-content');
    const over = { ...layout, root: pair('five', layout.root, duplicate) };
    assert.equal(domain.movePaneRegion(over, new Map(), key(leaves[0]), 'bottom-panel', domain.PANE_REGIONS).reason, 'invalid-layout');
});

test('every four-pane region/visibility combination partitions without mutation, loss or duplication', () => {
    const before = JSON.stringify(layout);
    for (let distribution = 0; distribution < 256; distribution++) {
        const assignments = new Map(leaves.map((leaf, index) => [key(leaf), domain.PANE_REGIONS[(distribution >> (index * 2)) & 3]]));
        for (let mask = 0; mask < 16; mask++) {
            const hidden = new Set(leaves.filter((_, index) => mask & (1 << index)).map(key));
            const regions = domain.projectPaneRegions(layout, assignments, hidden);
            const projected = Object.values(regions).flatMap(region => region ? collectLeaves(region.root) : []);
            assert.equal(projected.length, 4 - hidden.size);
            assert.equal(new Set(projected.map(key)).size, projected.length);
            for (const leaf of projected) {
                assert.ok(leaves.includes(leaf)); assert.ok(!hidden.has(key(leaf)));
                assert.ok(collectLeaves(regions[assignments.get(key(leaf))].root).includes(leaf));
            }
        }
    }
    assert.equal(JSON.stringify(layout), before);
});

test('dormant placement keys cannot create content and hiding does not erase placement', () => {
    const assignments = new Map(placements); assignments.set('not-owned', 'bottom-panel');
    const regions = domain.projectPaneRegions(layout, assignments, new Set([key(leaves[2])]));
    assert.equal(regions['secondary-sidebar'], null);
    assert.equal(assignments.get(key(leaves[2])), 'secondary-sidebar');
    assert.equal(Object.values(regions).flatMap(region => region ? collectLeaves(region.root) : []).length, 3);
    assert.equal(collectLeaves(layout.root).length, 4);
});

test('all region surfaces retain canonical ownership with one global focused pane', () => {
    const surfaces = paneRegionSurfaces(layout, domain.projectPaneRegions(layout, placements, empty), true);
    assert.equal(surfaces.length, 4);
    assert.ok(surfaces.every(surface => surface.layout === layout && surface.visible));
    assert.deepEqual([...new Set(surfaces.map(surface => surface.focusedPaneId))], [leaves[2].id]);
    const hidden = paneRegionSurfaces(layout, domain.projectPaneRegions(layout, placements, new Set([key(leaves[2])])), true);
    assert.equal(hidden[2].visible, false);
    assert.ok(hidden.filter(surface => surface.visible).every(surface => surface.focusedPaneId === leaves[0].id));
    const inactive = paneRegionSurfaces(layout, domain.projectPaneRegions(layout, placements, empty), false);
    assert.ok(inactive.every(surface => !surface.visible && surface.layout === layout));
});

test('geometry fractions are finite and leave positive center space at all bounds', () => {
    for (const input of [{}, { primary: Infinity, secondary: NaN, bottom: -Infinity },
        { primary: 99, secondary: 99, bottom: 99 }, { primary: -99, secondary: -99, bottom: -99 }]) {
        const sizes = domain.normalizePaneRegionSizes(input);
        assert.ok(Object.values(sizes).every(Number.isFinite));
        assert.ok(sizes.primary + sizes.secondary <= 0.7);
        assert.ok(sizes.bottom >= 0.2 && sizes.bottom <= 0.5);
    }
});

test('geometry frame allocates peripheral cells and keeps center recovery even with no visible panes', () => {
    for (const regions of [empty, new Set(domain.PANE_REGIONS)]) {
        const html = renderToStaticMarkup(React.createElement(PaneRegionFrame, { regions, renderRegion: region => region === 'workspace' ? 'Recovery' : '' }));
        assert.equal((html.match(/data-pane-region=/g) || []).length, 4);
        assert.match(html, /Recovery/); assert.match(html, /grid-column:2;grid-row:1/);
        assert.doesNotMatch(html, /NaN|Infinity|<iframe/);
    }
});
