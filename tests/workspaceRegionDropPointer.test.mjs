import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSource as source } from './helpers/loadSource.mjs';
class Target {
    listeners = new Map(); captured = new Set(); attributes = new Map();
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(event) { for (const fn of [...(this.listeners.get(event.type) ?? [])]) fn(event); }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    closest() { return null; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 100, bottom: 30, width: 100 }; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
}
const event = (type, data = {}) => ({ type, preventDefault() {}, cancelable: true, pointerId: 1, clientX: 20, clientY: 20, ...data });
const payload = { kind: 'term', termId: 'shell' };

test('drop overlay reads the current destination directly and disappears on cancellation', () => {
    const { dockTargetPresentation } = source('components/layout/tabDock/dropPresentation.ts', {});
    let live = { target: { kind: 'pane', paneId: 'shell', edge: 'right', preview: { left: 1, top: 2, width: 100, height: 40 } } };
    const { TabDockOverlay } = source('components/layout/tabDock/TabDockOverlay.tsx', {
        react: { useSyncExternalStore: (_subscribe, snapshot) => snapshot() },
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
        './session': { getTabDockLive: () => live, subscribeTabDock() {} },
        './dropPresentation': { dockTargetPresentation },
    });
    const preview = TabDockOverlay().props.children;
    assert.equal(preview.props.style.left, 1);
    assert.match(preview.props.className, /bg-app-accent\/10/);
    assert.doesNotMatch(preview.props.className, /border|shadow/);
    assert.equal(preview.props['data-pane-drop-mode'], 'split');
    assert.equal(preview.props.children.props.children[0].props.children, 'Split right');
    // Geometry may be identical; operation identity must still update the visible copy.
    live = { target: { kind: 'region', region: 'secondary-sidebar', preview: live.target.preview } };
    const dock = TabDockOverlay().props.children;
    assert.equal(dock.props['data-pane-drop-mode'], 'dock');
    assert.equal(dock.props.children.props.children[0].props.children, 'Dock right');
    assert.equal(dock.props.children.props.children[1].props.children, 'Stays visible across tabs');
    live = null; assert.equal(TabDockOverlay(), null);
});

test('strip drops reorder once, suppress the following click, and never dock a pane', () => {
    for (const outcome of ['accepted', 'stale', 'rejected']) {
        const stale = outcome === 'stale';
        const subject = harness(); const item = subject.instance(); const moves = [];
        const strip = new Target(), destination = new Target();
        destination.setAttribute('data-workspace-tab-contents', JSON.stringify(['destination']));
        destination.closest = selector => selector === '[data-workspace-tab-contents]' ? destination : strip;
        destination.getBoundingClientRect = () => ({ left: 0, top: 0, right: 30, bottom: 30, width: 30 });
        strip.querySelectorAll = () => [destination];
        item.node.setAttribute('data-workspace-tab-contents', JSON.stringify(['source']));
        item.node.isConnected = true;
        item.node.closest = selector => selector === '[data-workspace-tab-contents]' ? item.node : selector === '[data-tab-drag-strip]' ? strip : null;
        item.rerender({ onTabReorder: (...args) => { moves.push(args); return outcome !== 'rejected'; } });
        item.start(); subject.window.dispatch(event('pointermove'));
        assert.equal(subject.surface.getAttribute('data-pane-docking-strip'), 'true', 'Hide docking hints while reordering tabs');
        if (stale) item.node.setAttribute('data-workspace-tab-contents', JSON.stringify(['replacement']));
        subject.window.dispatch(event('pointerup'));
        assert.equal(moves.length, stale ? 0 : 1);
        assert.equal(item.calls.ends.length, 0);
        assert.equal(item.calls.cancels, outcome === 'accepted' ? 0 : 1);
        if (!stale) assert.equal(item.consume(), true, 'Rejected drags do not activate tabs through trailing clicks');
        assert.equal(subject.surface.getAttribute('data-pane-docking-strip'), null);
    }
});

test('reorder geometry rejects foreign strips, missing nodes, and malformed identities', () => {
    const { readTabContents } = source('components/layout/tabDock/tabReorder.ts', {});
    const { tabReorderTarget } = source('components/layout/tabDrag/reorder.ts', {});
    const strip = { getAttribute: () => null, querySelectorAll: () => [target], getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 30 }) }, other = {};
    const target = { closest: () => other, getAttribute: name => name === 'data-workspace-tab-contents' ? '["target"]' : null, getBoundingClientRect: () => ({ left: 0, width: 40, right: 40, top: 0, bottom: 30 }) };
    const sourceTab = { isConnected: true, closest: () => strip, getAttribute: () => null };
    assert.equal(tabReorderTarget(sourceTab, { x: 20, y: 0 }), null);
    target.closest = () => strip;
    assert.equal(tabReorderTarget(sourceTab, { x: 20, y: 0 }).after, true);
    sourceTab.getAttribute = () => 'true';
    assert.equal(tabReorderTarget(sourceTab, { x: 20, y: 0 }), null, 'Pinned boundaries do not offer misleading sort feedback');
    sourceTab.getAttribute = () => null;
    sourceTab.isConnected = false;
    assert.equal(tabReorderTarget(sourceTab, { x: 20, y: 0 }), null);
    for (const value of ['null', '{}', '[]', '[1]', 'broken', JSON.stringify(['1','2','3','4','5'])]) {
        assert.equal(readTabContents({ getAttribute: () => value }), null);
    }
});

test('dropping on an invalid strip slot cannot fall through to pane docking', () => {
    const subject = harness(); const item = subject.instance(); const strip = new Target();
    strip.querySelectorAll = () => [];
    item.node.isConnected = true;
    item.node.setAttribute('data-workspace-tab-contents', '["source"]');
    item.node.closest = selector => selector === '[data-workspace-tab-contents]' ? item.node : selector === '[data-tab-drag-strip]' ? strip : null;
    item.rerender({ onTabReorder: () => { assert.fail('No reorder target'); } });
    item.start(); subject.window.dispatch(event('pointermove')); subject.window.dispatch(event('pointerup'));
    assert.equal(item.calls.ends.length, 0); assert.equal(item.calls.cancels, 1);
});

test('pane headers return to the active strip or trailing open-tab area with exact release identity', () => {
    for (const axis of ['horizontal', 'vertical']) for (const trailing of [false, true]) for (const outcome of ['accepted', 'refused', 'escape', 'stale-source', 'stale-strip']) {
        const subject = harness(); const item = subject.instance();
        const strip = new Target(), destination = new Target();
        strip.isConnected = true; strip.style = {};
        strip.setAttribute('data-tab-drag-axis', axis);
        strip.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 60, width: 100, height: 60 });
        const insertionSurface = new Target();
        insertionSurface.getBoundingClientRect = () => ({ left: 0, top: 0, right: 160, bottom: 120, width: 160, height: 120 });
        strip.closest = selector => selector === '[data-tab-insertion-surface]' ? insertionSurface : strip;
        const point = trailing ? axis === 'horizontal' ? { clientX: 140, clientY: 20 } : { clientX: 20, clientY: 100 } : {};
        destination.closest = () => strip;
        destination.getBoundingClientRect = () => ({ left: 0, top: 0, right: 50, bottom: 30, width: 50, height: 30 });
        destination.setAttribute('data-workspace-tab-contents', '["destination"]');
        strip.querySelectorAll = () => [destination];
        const marker = new Target(); marker.style = {}; let appended = 0, removed = 0;
        marker.remove = () => removed++;
        strip.ownerDocument = { createElement: () => marker, body: { appendChild: () => appended++ } };
        let source = { contentId: 'shell', memberIds: ['shell', 'sibling'], pinned: false };
        let currentStrip = strip;
        const drops = [];
        item.rerender({ getTabStrip: () => currentStrip, getPaneTabSource: () => source,
            canDropPaneTab: () => outcome !== 'refused', onPaneTabDrop: insertion => {
                assert.equal(removed, 1, 'Transient marker is removed before state changes');
                drops.push(insertion); return true;
            } });
        item.start(); subject.window.dispatch(event('pointermove', point));
        assert.equal(appended, 1);
        assert.equal(marker.hidden, outcome === 'refused');
        assert.equal(subject.surface.getAttribute('data-pane-docking-strip'), 'true');
        assert.equal(subject.session.getTabDockLive().target, null, 'Strip drop never previews a pane split');
        if (outcome === 'stale-source') source = { ...source, memberIds: ['shell', 'replacement'] };
        if (outcome === 'stale-strip') currentStrip = new Target();
        if (outcome === 'escape') subject.window.dispatch(event('keydown', { key: 'Escape' }));
        subject.window.dispatch(event('pointerup', point));
        assert.equal(drops.length, outcome === 'accepted' ? 1 : 0, `${axis} ${trailing ? 'trailing' : 'slot'} ${outcome}`);
        if (drops.length) {
            assert.equal(drops[0].source, source);
            assert.deepEqual(Array.from(drops[0].target), ['destination']);
            assert.equal(drops[0].after, trailing || axis === 'vertical');
        }
        assert.equal(item.calls.ends.length, 0, 'No fallback docking on strip rejection/cancellation');
        assert.equal(removed, 1);
        assert.equal(subject.surface.getAttribute('data-pane-docking-strip'), null);
        assert.equal(subject.session.getTabDockLive(), null);
    }
});

test('trailing insertion appends past clipped slots but cannot consume other chrome or ordinary reorder', () => {
    const { tabInsertionTarget, tabReorderTarget, isOverTabInsertionSurface } = source('components/layout/tabDrag/reorder.ts', {});
    for (const vertical of [false, true]) {
        const rect = (start, end) => vertical
            ? { left: 0, right: 30, top: start, bottom: end, width: 30, height: end - start }
            : { left: start, right: end, top: 0, bottom: 30, width: end - start, height: 30 };
        const point = position => vertical ? { x: 20, y: position } : { x: position, y: 20 };
        const surface = { getBoundingClientRect: () => rect(0, 140) };
        const strip = { isConnected: true, getBoundingClientRect: () => rect(0, 100),
            getAttribute: () => vertical ? 'vertical' : 'horizontal', closest: () => surface,
            querySelectorAll: () => [first, foreign, last] };
        const first = { isConnected: true, closest: () => strip, getAttribute: () => null, getBoundingClientRect: () => rect(0, 50) };
        const last = { closest: () => strip, getBoundingClientRect: () => rect(200, 250) };
        const foreign = { closest: () => ({}), getBoundingClientRect: () => rect(300, 350) };
        assert.equal(tabInsertionTarget(strip, point(120)).element, last);
        assert.equal(tabInsertionTarget(strip, point(120)).after, true);
        assert.equal(tabReorderTarget(first, point(120)), null, 'Ordinary sorting retains its viewport');
        assert.equal(isOverTabInsertionSurface(strip, point(160)), false, 'Workspace actions remain outside the insertion surface');
        assert.equal(tabInsertionTarget(strip, point(160)), null);
        strip.isConnected = false;
        assert.equal(tabInsertionTarget(strip, point(120)), null);
    }
});

test('a header with no available tab strip retains its existing edge-docking behavior', () => {
    const subject = harness(); const item = subject.instance();
    item.rerender({ getTabStrip: () => null, getPaneTabSource: () => ({ contentId: 'shell', memberIds: ['shell', 'sibling'], pinned: false }) });
    item.start(); subject.window.dispatch(event('pointermove')); subject.window.dispatch(event('pointerup'));
    assert.equal(item.calls.ends.length, 1);
    assert.equal(item.calls.cancels, 0);
});

/** Run the actual gesture hook and live-session module; only DOM hit geometry and timers are isolated. */
function harness({ autoFrames = true } = {}) {
    const window = new Target(); const surface = new Target(); const timers = new Map(); let timer = 0;
    window.setTimeout = fn => { timers.set(++timer, fn); return timer; }; window.clearTimeout = id => timers.delete(id);
    const frames = new Map(); let frameId = 0; let hitReads = 0;
    window.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
    window.cancelAnimationFrame = id => frames.delete(id);
    const flushFrames = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); };
    window.dispatch = event => { Target.prototype.dispatch.call(window, event); if (autoFrames) flushFrames(); };
    const session = source('components/layout/tabDock/session.ts', {});
    const target = { kind: 'region', region: 'bottom-panel', preview: { left: 0, top: 70, width: 100, height: 30 } };
    let hit = target;
    let suppressed = 0;
    const pointerSession = source('components/layout/tabDrag/pointerSession.ts', {
        './suppressDropClick': { suppressDropClick: () => suppressed++ },
    }, { window });
    function instance() {
        const refs = []; let cursor = 0; let dispose;
        const calls = { starts: [], ends: [], cancels: 0 }; const node = new Target();
        let enabled = true; let currentSurface = surface;
        let handlers = { contextId: 'one', isEnabled: () => enabled, getSurface: () => currentSurface,
            onDragStart: value => calls.starts.push(value), onDragEnd: (...args) => calls.ends.push(args), onDragCancel: () => calls.cancels++ };
        const react = { useCallback: fn => fn, useEffect: effect => { if (!dispose) dispose = effect(); },
            useRef: initial => { const i = cursor++; if (!(i in refs)) refs[i] = { current: initial }; return refs[i]; } };
        const { useDockTabPointer } = source('components/layout/tabDock/useDockTabPointer.ts', {
            react,
            './session': session, './hit': { dockTargetFromPointer: () => { hitReads++; return hit; } },
            './tabReorder': source('components/layout/tabDock/tabReorder.ts', {}),
            '../tabDrag/preview': source('components/layout/tabDrag/preview.ts', {}),
            '../tabDrag/reorder': source('components/layout/tabDrag/reorder.ts', {}),
            '../tabDrag/useTabDragPointer': source('components/layout/tabDrag/useTabDragPointer.ts', {
                react, './pointerSession': pointerSession,
            }, { window, Element: Target }),
        }, { window, Element: Target, HTMLElement: Target });
        const render = (patch = {}) => { handlers = { ...handlers, ...patch }; cursor = 0; return useDockTabPointer(handlers); };
        let hook = render();
        return { calls, node, start: (patch = {}) => hook.begin({ button: 0, isPrimary: true, clientX: 0, clientY: 0,
                pointerId: 1, target: node, currentTarget: node, ...patch }, payload),
            rerender: patch => { hook = render(patch); }, disable: () => { enabled = false; },
            replaceSurface: () => { currentSurface = new Target(); },
            consume: () => hook.consumeClickIfDragged(), dispose: () => dispose?.() };
    }
    return { instance, window, surface, session, target, suppressed: () => suppressed, timers, setHit: value => { hit = value; },
        flushFrames, frames, hitReads: () => hitReads };
}

test('pointer bursts paint once per frame and completion cancels queued work', () => {
    const subject = harness({ autoFrames: false }); const item = subject.instance(); item.start();
    for (let x = 20; x < 40; x++) subject.window.dispatch(event('pointermove', { clientX: x }));
    assert.equal(subject.frames.size, 1); assert.equal(subject.hitReads(), 0);
    subject.flushFrames(); assert.equal(subject.hitReads(), 1);
    subject.window.dispatch(event('pointermove', { clientX: 50 }));
    subject.window.dispatch(event('pointerup', { clientX: 51 }));
    assert.equal(item.calls.ends.length, 1); assert.equal(subject.frames.size, 0);
    assert.equal(subject.hitReads(), 2, 'Drop revalidates fresh geometry synchronously');
    subject.flushFrames(); assert.equal(subject.hitReads(), 2);
});

test('cancel or unmount before the queued frame leaves no stale paint or feedback', () => {
    for (const unmount of [true, false]) {
        const subject = harness({ autoFrames: false }); const item = subject.instance(); item.start();
        subject.window.dispatch(event('pointermove'));
        if (unmount) item.dispose(); else subject.window.dispatch(event('keydown', { key: 'Escape' }));
        assert.equal(subject.frames.size, 0); subject.flushFrames();
        assert.equal(subject.hitReads(), 0); assert.equal(subject.session.getTabDockLive(), null);
        assert.equal(subject.surface.attributes.size, 0);
    }
});

test('floating feedback copies only inert tab chrome and preserves the grabbed point', () => {
    const { createTabDragPreview } = source('components/layout/tabDrag/preview.ts', {});
    const node = new Target();
    const ghost = new Target(); ghost.style = {}; ghost.getBoundingClientRect = () => ({ width: 80, height: 28 });
    const clone = {}; let copied;
    node.querySelector = selector => { assert.equal(selector, '[data-tab-drag-preview]'); return { cloneNode: deep => { assert.equal(deep, true); return clone; } }; };
    node.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 28 });
    ghost.appendChild = child => { copied = child; };
    let removed = 0, appended = 0;
    ghost.remove = () => removed++;
    node.closest = () => node;
    node.ownerDocument = { defaultView: { innerWidth: 200, innerHeight: 100 }, createElement: () => ghost, body: { appendChild: () => appended++ } };
    const feedback = createTabDragPreview(node, { x: 35, y: 30 });
    assert.equal(copied, clone); assert.equal(ghost.inert, true); assert.equal(ghost.getAttribute('aria-hidden'), 'true');
    assert.equal(appended, 1); assert.equal(node.getAttribute('data-tab-dragging'), 'true');
    feedback.move({ x: 195, y: 95 }); assert.equal(ghost.style.transform, 'translate3d(170px, 85px, 0)');
    assert.equal(ghost.style.width, '100px');
    feedback.dispose(); assert.equal(removed, 1); assert.equal(node.getAttribute('data-tab-dragging'), null);
});

test('sort feedback slides variable-size chrome on either axis without moving layout slots', () => {
    const { createTabReorderFeedback } = source('components/layout/tabDrag/reorder.ts', {});
    for (const axis of ['horizontal', 'vertical']) {
    const visuals = [0, 1, 2].map(() => ({ style: { removeProperty(name) { delete this[name]; } } }));
    const bounds = [{ left: 0, right: 100, width: 100 }, { left: 104, right: 244, width: 140 }, { left: 248, right: 328, width: 80 }]
        .map(rect => axis === 'vertical' ? { top: rect.left, bottom: rect.right, height: rect.width } : rect);
    const strip = { getAttribute: () => axis };
    const elements = bounds.map((rect, index) => ({ isConnected: true, closest: () => strip, getBoundingClientRect: () => rect, querySelector: () => visuals[index] }));
    for (const element of elements) element.parentElement = { querySelectorAll: () => elements };
    const feedback = createTabReorderFeedback(elements[0]);
    feedback.update({ element: elements[2], after: true });
    const translate = axis === 'vertical' ? 'translateY' : 'translateX';
    assert.equal(visuals[1].style.transform, `${translate}(-104px)`);
    assert.equal(visuals[2].style.transform, `${translate}(-104px)`);
    assert.equal(visuals[0].style.transform, undefined);
    feedback.update(null);
    assert.ok(visuals.every(visual => visual.style.transform === undefined));
    const backwards = createTabReorderFeedback(elements[2]);
    backwards.update({ element: elements[0], after: false });
    assert.equal(visuals[0].style.transform, `${translate}(84px)`);
    backwards.dispose();
    assert.ok(visuals.every(visual => visual.style.transform === undefined && visual.style.transition === undefined));
    }
});

test('region gestures are scoped, thresholded and deliver a typed target without a trailing click', () => {
    const test = harness(); const item = test.instance(); item.start();
    test.window.dispatch(event('pointermove', { clientX: 3, clientY: 3 })); assert.equal(test.session.getTabDockLive(), null);
    test.window.dispatch(event('pointermove', { pointerId: 2 })); assert.equal(item.calls.starts.length, 0);
    test.window.dispatch(event('pointermove'));
    assert.equal(test.session.getTabDockLive().contextId, 'one');
    assert.equal(test.session.getTabDockLive().target, test.target); assert.equal(item.node.hasPointerCapture(1), true);
    test.window.dispatch(event('pointerup', { pointerId: 2 })); assert.equal(item.calls.ends.length, 0);
    test.window.dispatch(event('pointerup'));
    assert.deepEqual(item.calls.ends, [[payload, test.target]]); assert.equal(test.session.getTabDockLive(), null);
    assert.equal(test.suppressed(), 1); assert.equal(item.consume(), true); assert.equal(item.consume(), false);
    assert.equal(item.node.captured.size, 0); assert.equal(test.surface.attributes.size, 0); item.dispose();
});
test('scope change, inactive view, replaced surface, blur, Escape, pointer cancel and unmount cannot drop', () => {
    for (const reason of ['scope', 'inactive', 'surface', 'blur', 'Escape', 'pointercancel', 'capture', 'unmount']) {
        const test = harness(); const item = test.instance(); item.start(); test.window.dispatch(event('pointermove'));
        if (reason === 'scope') item.rerender({ contextId: 'two' });
        if (reason === 'inactive') item.disable();
        if (reason === 'surface') item.replaceSurface();
        if (['scope', 'inactive', 'surface'].includes(reason)) test.window.dispatch(event('pointerup'));
        else if (reason === 'unmount') item.dispose();
        else if (reason === 'capture') item.node.dispatch(event('lostpointercapture'));
        else test.window.dispatch(event(reason === 'Escape' ? 'keydown' : reason, { key: 'Escape' }));
        assert.equal(item.calls.ends.length, 0, reason); assert.equal(item.calls.cancels, 1, reason);
        assert.equal(test.session.getTabDockLive(), null, reason); assert.equal(test.surface.attributes.size, 0, reason);
        assert.equal(item.node.captured.size, 0, reason); assert.equal(test.suppressed(), 0, reason);
        assert.equal([...test.window.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0), 0, reason);
        item.dispose();
    }
});
test('unmounting an unrelated pane or canceling an unstarted gesture cannot end another pane drag', () => {
    const test = harness(); const first = test.instance(); const unused = test.instance(); const second = test.instance();
    second.start({ pointerId: 2 }); first.start(); test.window.dispatch(event('pointermove'));
    const live = test.session.getTabDockLive(); unused.dispose(); assert.equal(test.session.getTabDockLive(), live);
    test.window.dispatch(event('pointermove', { pointerId: 2 }));
    assert.equal(test.session.getTabDockLive(), live); assert.equal(second.calls.starts.length, 0);
    test.window.dispatch(event('pointerup')); assert.equal(first.calls.ends.length, 1); first.dispose(); second.dispose();
});
test('disabled and non-primary initiators leave the shared drag session untouched', () => {
    const test = harness(); const item = test.instance(); item.start({ isPrimary: false });
    item.disable(); item.start(); test.window.dispatch(event('pointermove'));
    assert.equal(item.calls.starts.length, 0); assert.equal(test.session.getTabDockLive(), null); item.dispose();
});

test('a refused start cannot cancel or remove feedback from an externally owned docking session', () => {
    const subject = harness(); const item = subject.instance();
    subject.session.startTabDock(payload, 'external');
    subject.surface.setAttribute('data-pane-docking', 'true');
    const existing = subject.session.getTabDockLive();
    item.start(); subject.window.dispatch(event('pointermove')); item.dispose();
    assert.equal(item.calls.starts.length, 0); assert.equal(item.calls.cancels, 0);
    assert.equal(subject.session.getTabDockLive(), existing);
    assert.equal(subject.surface.getAttribute('data-pane-docking'), 'true');
});
test('a disappearing region guide cannot fall through to an underlying pane split on release', () => {
    const test = harness(); const item = test.instance(); item.start(); test.window.dispatch(event('pointermove'));
    test.setHit({ kind: 'pane', paneId: 'shell', edge: 'left', preview: test.target.preview });
    test.window.dispatch(event('pointerup'));
    assert.equal(item.calls.ends.length, 0); assert.equal(item.calls.cancels, 1);
    assert.equal(test.session.getTabDockLive(), null); item.dispose();
});
test('session deduplication distinguishes a region from a pane and different region destinations', () => {
    const test = harness(); let notifications = 0;
    const unsubscribe = test.session.subscribeTabDock(() => notifications++);
    test.session.startTabDock(payload, 'one'); test.session.patchTabDockTarget(test.target);
    test.session.patchTabDockTarget({ ...test.target }); assert.equal(notifications, 2);
    test.session.patchTabDockTarget({ ...test.target, region: 'workspace' }); assert.equal(notifications, 3);
    test.session.patchTabDockTarget({ kind: 'pane', paneId: 'a', edge: 'bottom', preview: test.target.preview });
    assert.equal(notifications, 4); assert.equal(test.session.getTabDockLive().contextId, 'one'); unsubscribe();
});
