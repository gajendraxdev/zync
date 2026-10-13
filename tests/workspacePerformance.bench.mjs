/**
 * Diagnostic benchmark of pure workspace work, not a release latency assertion.
 * Run with: node tests/workspacePerformance.bench.mjs
 * It creates synthetic in-memory resources only; no app settings, PTYs, plugins,
 * network or production files are accessed. TypeScript loading is outside timing.
 * Report batch-free per-operation samples; compare on the same machine/runtime.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { loadWorkspaceDomain } from './helpers/loadWorkspaceDomain.mjs';

const { workspaceDockingView, projectWorkspaceDockingView } = loadWorkspaceDomain('features/workspace/domain/dockingView.ts');
const { parseWorkspaceDocking } = loadWorkspaceDomain('features/workspace/domain/docking.ts');
const { workspaceDockingSurfaces } = loadWorkspaceDomain('components/workspace/workspaceDockingSurfaces.ts');
const { retainPaneSurfaces } = loadWorkspaceDomain('components/workspace/paneSurfaces.ts');
const { retainLiveItems, retainedItemsInMountOrder } = loadWorkspaceDomain('components/layout/retainedItems.ts');
const { paneContentKey } = loadWorkspaceDomain('lib/paneLayout/contentIdentity.ts');

/** At most one center plus three docks is visible; dormant metadata opens nothing. */
function workload(scopes, centers, dormant) {
    const state = { terminals: {}, paneLayouts: {}, activeTerminalIds: {}, activePaneGroupOwner: {},
        contentPresentation: {}, workspaceDockFocus: {}, workspaceDocking: {} };
    for (let scopeIndex = 0; scopeIndex < scopes; scopeIndex++) {
        const scope = `scope-${scopeIndex}`;
        const terminals = Array.from({ length: centers + 3 }, (_, index) => ({ id: `${scope}-term-${index}`, title: `Shell ${index}` }));
        const groups = Object.fromEntries(terminals.map(terminal => [terminal.id,
            { version: 1, activePaneId: terminal.id, root: { type: 'pane', id: terminal.id, content: { kind: 'term', termId: terminal.id } } }]));
        const key = index => paneContentKey(groups[terminals[index].id].root.content, terminals[index].id);
        state.terminals[scope] = terminals;
        state.paneLayouts[scope] = groups;
        state.activeTerminalIds[scope] = terminals[0].id;
        state.activePaneGroupOwner[scope] = terminals[0].id;
        state.workspaceDocking[scope] = { version: 1, placements: Object.fromEntries([
            [key(centers), 'primary-sidebar'], [key(centers + 1), 'secondary-sidebar'], [key(centers + 2), 'bottom-panel'],
            ...Array.from({ length: dormant }, (_, index) => [JSON.stringify(['term', `${scope}-dormant-${index}`]), 'bottom-panel']),
        ]) };
    }
    return state;
}

let checksum = 0;
function measure(label, run, samples = 40) {
    for (let index = 0; index < 8; index++) checksum += run(index);
    const elapsed = [];
    for (let index = 0; index < samples; index++) {
        const started = performance.now();
        checksum += run(index);
        elapsed.push(performance.now() - started);
    }
    elapsed.sort((left, right) => left - right);
    return { label, samples, medianMs: +elapsed[Math.floor(elapsed.length / 2)].toFixed(4),
        p95Ms: +elapsed[Math.ceil(elapsed.length * 0.95) - 1].toFixed(4) };
}

const measurements = [];
for (const [label, scopes, centers, dormant] of [
    ['small', 1, 8, 0], ['busy', 16, 32, 32], ['metadata-limit', 256, 32, 253],
]) {
    const state = workload(scopes, centers, dormant);
    const scope = 'scope-0';
    const visited = new Set(state.terminals[scope].map(terminal => JSON.stringify(['term', terminal.id])));
    const validated = parseWorkspaceDocking(state.workspaceDocking);
    assert.equal(validated.ok, true);
    assert.deepEqual(projectWorkspaceDockingView(state, scope, validated), workspaceDockingView(state, scope));
    for (const reuse of [false, true]) measurements.push(measure(`${label}: ${reuse ? 'unchanged preferences' : 'fresh validation'} + allocation`, index => {
        const selected = `${scope}-term-${index % centers}`;
        state.activePaneGroupOwner[scope] = selected; state.activeTerminalIds[scope] = selected;
        const view = reuse ? projectWorkspaceDockingView(state, scope, validated) : workspaceDockingView(state, scope);
        assert.equal(view.projection.ok, true);
        const surfaces = workspaceDockingSurfaces(view.canvases, view.projection.value, true);
        assert.equal(surfaces.filter(surface => surface.visible).length, 4);
        const retained = retainPaneSurfaces(surfaces, visited);
        assert.equal(retained.length, centers + 3);
        return retained.length;
    }));
}
for (const size of [8, 32, 256]) {
    const items = Array.from({ length: size }, (_, index) => ({ id: `workspace-${index}` }));
    const ids = items.map(item => item.id); const visited = new Set(ids);
    measurements.push(measure(`${size} main tabs: retention projection`, index => {
        const retained = retainLiveItems(ids, visited, ids[index % size]);
        const ordered = retainedItemsInMountOrder(items, retained);
        assert.equal(ordered.length, size); return ordered.length;
    }));
}
console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch,
    methodology: '40 individual samples after 8 warm-ups; pure operations only, no DOM/native lifecycle or cold startup measurement',
    measurements, checksum }, null, 2));
