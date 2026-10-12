import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workspaceCanvases } from '../.tmp-agent-tests/src/features/workspace/domain/canvases.js';
import { projectWorkspaceDocking, projectMaximizedWorkspacePane } from '../.tmp-agent-tests/src/features/workspace/domain/dockingProjection.js';
import { workspaceDockingSurfaces } from '../.tmp-agent-tests/src/components/workspace/workspaceDockingSurfaces.js';
import { retainPaneSurfaces } from '../.tmp-agent-tests/src/components/workspace/paneSurfaces.js';
import { PANE_REGIONS } from '../.tmp-agent-tests/src/lib/paneLayout/regions.js';
import { paneContentKey } from '../.tmp-agent-tests/src/lib/paneLayout/contentIdentity.js';
import { collectLeaves } from '../.tmp-agent-tests/src/lib/paneLayout/query.js';

const term = (id, pane = id) => ({ type: 'pane', id: pane, content: { kind: 'term', termId: id } });
const key = leaf => paneContentKey(leaf.content, leaf.id);
const pair = (id, a, b) => ({ type: 'split', id, direction: 'horizontal', sizes: [0.4, 0.6], children: [a, b] });
const canvas = (owner, root, active = collectLeaves(root)[0].id) => ({ owner, layout: { version: 1, root, activePaneId: active } });
const leaves = [term('a'),
    { type: 'pane', id: 'f', content: { kind: 'feature', featureId: 'files', instanceId: 'f' } },
    term('b'), { type: 'pane', id: 'p', content: { kind: 'plugin', pluginId: 'sample', instanceId: 'p' } }];
const canvases = [canvas('a', pair('split-a', leaves[0], leaves[1])), canvas('b', pair('split-b', leaves[2], leaves[3]))];
const empty = new Set();
const assignments = new Map([[key(leaves[1]), 'primary-sidebar'], [key(leaves[3]), 'bottom-panel']]);
function project(input = canvases, placement = assignments, hidden = empty, selected = 'a', focus = null) {
    const result = projectWorkspaceDocking(input, placement, hidden, selected, focus);
    assert.equal(result.ok, true, result.reason);
    return result.value;
}
const keys = allocations => allocations.flatMap(({ layout }) => collectLeaves(layout.root).map(key));

test('maximizing any visible kind changes geometry only and keeps a reachable restore header', () => {
    const snapshot = JSON.stringify({ canvases, placements: [...assignments] });
    for (const target of [leaves[0], leaves[1], leaves[3]]) {
        const base = project(canvases, assignments, empty, 'a', key(target));
        const zoom = projectMaximizedWorkspacePane(base, { contentId: key(target), selectedOwner: 'a' }, 'a');
        assert.equal(zoom.maximizedContentId, key(target));
        assert.deepEqual(keys(zoom.regions.workspace), [key(target)]);
        assert.ok(PANE_REGIONS.filter(region => region !== 'workspace').every(region => !zoom.regions[region].length));
        const surfaces = workspaceDockingSurfaces(canvases, zoom, true);
        assert.deepEqual(surfaces.filter(surface => surface.visible).map(surface => surface.key), [key(target)]);
        assert.ok(surfaces.find(surface => surface.key === key(target)).split, 'restore header survives a one-leaf projection');
        assert.equal(surfaces.length, leaves.length, 'non-maximized resources stay in canonical inventory');
        assert.equal(projectMaximizedWorkspacePane(base, undefined, 'a'), base, 'restore shares the original projection');
    }
    assert.equal(JSON.stringify({ canvases, placements: [...assignments] }), snapshot);
});

test('stale, hidden, unselected and newly focused targets never receive maximized geometry', () => {
    const request = { contentId: key(leaves[3]), selectedOwner: 'a' };
    const hidden = project(canvases, assignments, new Set([request.contentId]), 'a', request.contentId);
    for (const [base, owner] of [[project(), 'a'], [hidden, 'a'], [project(canvases, assignments, empty, 'b', request.contentId), 'b']]) {
        assert.equal(projectMaximizedWorkspacePane(base, request, owner), base);
    }
    const base = project();
    assert.equal(projectMaximizedWorkspacePane(base, { contentId: 'missing', selectedOwner: 'a' }, 'a'), base);
});

test('canonical connection inventory includes standalone/hidden shells without duplicating group ownership', () => {
    const groups = Object.fromEntries(canvases.map(({ owner, layout }) => [owner, layout]));
    const terminals = [{ id: 'a' }, { id: 'b', tabVisible: false }, { id: 'standalone', tabVisible: false }];
    const before = JSON.stringify({ groups, terminals });
    const inventory = workspaceCanvases(terminals, groups);
    assert.deepEqual(inventory.map(item => item.owner), ['a', 'b', 'standalone']);
    assert.equal(inventory[0].layout, groups.a); assert.equal(inventory[1].layout, groups.b);
    assert.equal(inventory[2].layout.root.content.termId, 'standalone');
    assert.equal(JSON.stringify({ groups, terminals }), before);
    assert.deepEqual(workspaceCanvases([], undefined), []);
    const repeated = workspaceCanvases([{ id: 'same' }, { id: 'same' }], undefined);
    assert.equal(repeated.length, 2);
    assert.equal(projectWorkspaceDocking(repeated, new Map(), empty, 'same').reason, 'duplicate-owner');
});

test('center tab switching retains every dock and its original tree/leaf identity without changing inventory', () => {
    const a = project(); const b = project(canvases, assignments, empty, 'b');
    assert.deepEqual(keys(a.regions.workspace), [key(leaves[0])]);
    assert.deepEqual(keys(b.regions.workspace), [key(leaves[2])]);
    for (const region of ['primary-sidebar', 'bottom-panel']) {
        assert.deepEqual(a.regions[region], b.regions[region]);
        for (const allocation of b.regions[region]) {
            assert.equal(allocation.canonical, canvases.find(item => item.owner === allocation.owner).layout);
            assert.ok(leaves.includes(allocation.layout.root));
        }
    }
    const visited = new Set(leaves.map(key));
    const before = retainPaneSurfaces(workspaceDockingSurfaces(canvases, a, true), visited);
    const after = retainPaneSurfaces(workspaceDockingSurfaces([...canvases].reverse(), b, true), visited);
    assert.deepEqual(after.map(surface => surface.key), before.map(surface => surface.key));
    assert.equal(after.length, 4);
    for (const surface of after) assert.equal(surface.node, before.find(item => item.key === surface.key).node);
});

test('one exact content key owns focus even when different canvases reuse a local pane ID', () => {
    const first = term('one', 'local-id'); const second = term('two', 'local-id');
    const input = [canvas('one', first), canvas('two', second)];
    const placement = new Map([[key(second), 'bottom-panel']]);
    const projection = project(input, placement, empty, 'one', key(second));
    const surfaces = workspaceDockingSurfaces(input, projection, true);
    assert.deepEqual(surfaces.filter(surface => surface.focused).map(surface => surface.key), [key(second)]);
    assert.ok(surfaces.every(surface => surface.visible && surface.split));
    assert.ok(workspaceDockingSurfaces(input, projection, false).every(surface => !surface.visible && !surface.focused));
});

test('focus ignores hidden, stale and unselected center content, with deterministic recovery', () => {
    const requested = key(leaves[3]);
    assert.equal(project(canvases, assignments, empty, 'a', requested).focusedContentId, requested);
    assert.equal(project(canvases, assignments, new Set([requested]), 'a', requested).focusedContentId, key(leaves[0]));
    assert.equal(project(canvases, assignments, empty, 'a', key(leaves[2])).focusedContentId, key(leaves[0]));
    const allHidden = project(canvases, assignments, new Set(leaves.map(key)), 'a', requested);
    assert.equal(allHidden.focusedContentId, null);
    assert.ok(PANE_REGIONS.every(region => allHidden.regions[region].length === 0));
    assert.ok(workspaceDockingSurfaces(canvases, allHidden, true).every(surface => !surface.visible && !surface.focused));
});

test('absent or stale center selection leaves only docks; dormant preferences never open content', () => {
    const placement = new Map([...assignments, [key(term('not-live')), 'secondary-sidebar']]);
    for (const selected of [null, 'missing']) {
        const projection = project(canvases, placement, empty, selected, 'missing');
        assert.equal(projection.regions.workspace.length, 0);
        assert.equal(projection.regions['secondary-sidebar'].length, 0);
        assert.equal(projection.focusedContentId, key(leaves[1]));
        assert.equal(workspaceDockingSurfaces(canvases, projection, true).filter(surface => surface.visible).length, 2);
    }
});

test('default projection shares the selected tree and keeps real split IDs/ratios for resizing', () => {
    const projection = project(canvases, new Map());
    assert.equal(projection.regions.workspace[0].layout, canvases[0].layout);
    const bothBottom = new Map(leaves.map(leaf => [key(leaf), 'bottom-panel']));
    const docked = project(canvases, bothBottom);
    assert.equal(docked.regions['bottom-panel'].length, 2);
    for (const allocation of docked.regions['bottom-panel']) {
        assert.equal(allocation.layout, allocation.canonical);
        assert.ok(['split-a', 'split-b'].includes(allocation.layout.root.id));
    }
});

test('invalid ownership and over-cap reservations return no partially usable allocation', () => {
    const full = canvas('full', pair('s1', pair('s2', term('c'), term('d')), pair('s3', term('e'), term('f'))));
    const cases = [
        [[canvases[0], { ...canvases[1], owner: 'a' }], new Map(), 'duplicate-owner'],
        [[canvases[0], canvas('duplicate', leaves[0])], new Map(), 'duplicate-content'],
        [[canvases[0], full], assignments, 'capacity'],
    ];
    for (const [input, placement, reason] of cases) {
        const before = JSON.stringify(input);
        const result = projectWorkspaceDocking(input, placement, empty, 'a');
        assert.deepEqual(result, { ok: false, reason });
        assert.equal(JSON.stringify(input), before);
    }
});

test('all cross-canvas region/visibility combinations retain canonical membership and a single focus owner', () => {
    const before = JSON.stringify(canvases);
    for (let distribution = 0; distribution < 256; distribution++) {
        const placement = new Map(leaves.map((leaf, index) => [key(leaf), PANE_REGIONS[(distribution >> (index * 2)) & 3]]));
        for (let mask = 0; mask < 16; mask++) {
            const hidden = new Set(leaves.filter((_, index) => mask & (1 << index)).map(key));
            for (const selected of ['a', 'b', null]) {
                const projection = project(canvases, placement, hidden, selected);
                const surfaces = workspaceDockingSurfaces(canvases, projection, true);
                assert.deepEqual(surfaces.map(surface => surface.key), leaves.map(key));
                const expected = leaves.filter(leaf => !hidden.has(key(leaf)) && (placement.get(key(leaf)) !== 'workspace'
                    || canvases.find(item => collectLeaves(item.layout.root).includes(leaf)).owner === selected)).map(key);
                assert.deepEqual(surfaces.filter(surface => surface.visible).map(surface => surface.key), expected);
                assert.equal(surfaces.filter(surface => surface.focused).length, expected.length ? 1 : 0);
                assert.ok(surfaces.every(surface => leaves.includes(surface.node)));
            }
        }
    }
    assert.equal(JSON.stringify(canvases), before);
});
