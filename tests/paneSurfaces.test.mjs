import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function loadSource(path, dependencies, globals = {}) {
    const source = readFileSync(path, 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    const context = { exports: {}, require: name => dependencies[name], ...globals };
    runInNewContext(outputText, context);
    return context.exports;
}

const { paneSurfaceKey, layoutSurfaces, retainPaneSurfaces } = loadSource(
    'src/components/workspace/paneSurfaces.ts',
    { '../../lib/paneLayout': { isPaneLeaf: node => node.type === 'pane' } },
);
const plugin = { type: 'pane', id: 'pane-a', content: { kind: 'plugin', pluginId: 'plugin', instanceId: 'instance-a' } };
const files = { type: 'pane', id: 'pane-b', content: { kind: 'feature', featureId: 'files', instanceId: 'instance-b' } };
const shell = { type: 'pane', id: 'pane-c', content: { kind: 'term', termId: 'shell' } };
const single = root => ({ version: 1, root, activePaneId: root.id });
const split = (first, second, direction = 'horizontal') => ({
    version: 1, activePaneId: first.id,
    root: { type: 'split', id: 'split', direction, sizes: [0.5, 0.5], children: [first, second] },
});

assert.equal(paneSurfaceKey(plugin), paneSurfaceKey({ ...plugin, id: 'moved-leaf' }));
assert.equal(paneSurfaceKey(shell), paneSurfaceKey({ ...shell, id: 'split-shell' }));
assert.notEqual(paneSurfaceKey(plugin), paneSurfaceKey({ ...plugin, content: { ...plugin.content, instanceId: 'duplicate' } }));
assert.notEqual(paneSurfaceKey(plugin), paneSurfaceKey({ ...plugin, content: { ...plugin.content, pluginId: 'replacement' } }));
const legacy = { ...plugin, content: { kind: 'plugin', pluginId: 'legacy' } };
assert.notEqual(paneSurfaceKey(legacy), paneSurfaceKey({ ...legacy, id: 'other-legacy-pane' }));
assert.equal(layoutSurfaces(JSON.parse(JSON.stringify(single(plugin))), true)[0].key, paneSurfaceKey(plugin), 'Session restore uses persisted identity');

const initial = retainPaneSurfaces(layoutSurfaces(single(plugin), true), new Set());
const visited = new Set(initial.map(surface => surface.key));
let surfaces = retainPaneSurfaces(layoutSurfaces(split(files, plugin), true), visited);
assert.equal(surfaces.find(surface => surface.node === plugin).key, initial[0].key, 'Splitting/reordering retains content identity');
assert.equal(surfaces[0].node, plugin, 'Surviving hosts retain DOM order regardless of split order');
assert.equal(surfaces.find(surface => surface.node === files).edges.right, true);
assert.equal(surfaces.find(surface => surface.node === plugin).edges.left, true);
surfaces = retainPaneSurfaces(layoutSurfaces(single(plugin), false), visited);
assert.equal(surfaces.length, 1, 'Hiding retains visited content');
assert.equal(surfaces[0].visible, false);
assert.equal(retainPaneSurfaces(layoutSurfaces(single(files), false), visited).length, 0, 'Unvisited content does not mount');
assert.equal(retainPaneSurfaces([], visited).length, 0, 'Closing disposes content');
const nested = split(files, split(plugin, shell, 'vertical').root);
assert.equal(layoutSurfaces(nested, true).find(surface => surface.node === plugin).edges.bottom, true);
assert.equal(layoutSurfaces(nested, true).find(surface => surface.node === plugin).edges.left, true);

// Exercise the geometry adapter with disposable slots and persistent host nodes.
const effects = [];
const callbacks = new Map();
const cancelled = [];
const observed = new Set();
const listeners = new Set();
let nextFrame = 0;
const react = {
    useCallback: callback => callback,
    useRef: current => ({ current }),
    useLayoutEffect: effect => effects.push(effect),
};
class FakeObserver {
    constructor(callback) { this.callback = callback; }
    observe(node) { observed.add(node); }
    unobserve(node) { observed.delete(node); }
    disconnect() { observed.clear(); }
}
const { usePaneSurfaceGeometry } = loadSource('src/components/workspace/usePaneSurfaceGeometry.ts', { react }, {
    ResizeObserver: FakeObserver,
    requestAnimationFrame: callback => { callbacks.set(++nextFrame, callback); return nextFrame; },
    cancelAnimationFrame: id => { cancelled.push(id); callbacks.delete(id); },
    window: { addEventListener: name => listeners.add(name), removeEventListener: name => listeners.delete(name) },
});
const root = { getBoundingClientRect: () => ({ left: 10, top: 20 }) };
const geometry = usePaneSurfaceGeometry({ current: root });
const cleanup = effects[0]();
let rectangle = { left: 30, top: 50, width: 200, height: 100 };
const slot = { getClientRects: () => [rectangle], getBoundingClientRect: () => rectangle };
const host = { style: {} };
geometry.registerHost('pane', host);
geometry.registerSlot('pane', slot);
assert.equal(callbacks.size, 1, 'Resize work is frame-coalesced');
effects[1]();
assert.equal(host.style.left, '20px');
assert.equal(host.style.top, '30px');
assert.equal(host.style.width, '200px');
geometry.registerSlot('pane', null);
effects[1]();
assert.equal(host.style.visibility, 'hidden', 'Detached slots cannot leave ghost content visible');
assert.equal(observed.has(slot), false);
rectangle = { left: 400, top: 80, width: 100, height: 200 };
geometry.registerSlot('pane', slot);
effects[1]();
assert.equal(host.style.left, '390px', 'The same host follows a new allocation');
assert.equal(host.style.height, '200px');
cleanup();
assert.equal(observed.size, 0);
assert.equal(listeners.size, 0);
assert.equal(callbacks.size, 0, 'Unmount cancels scheduled geometry work');
assert.ok(cancelled.length > 0);
const leafSource = readFileSync('src/components/terminal/PaneLeafView.tsx', 'utf8');
assert.doesNotMatch(leafSource, /key=\{node.id\}/, 'Leaf geometry changes must not recreate the body');
assert.match(leafSource, /isActiveTab=\{panelVisible\}/, 'Retained hidden terminals cannot activate PTYs');
const layoutSource = readFileSync('src/components/terminal/PaneLayoutView.tsx', 'utf8');
assert.doesNotMatch(layoutSource, /<TerminalComponent|<FeaturePaneBody|<PluginPanel/, 'Split trees allocate space, not content lifetimes');
console.log('Stable pane identity, retention, geometry and cleanup tests passed.');
