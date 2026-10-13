import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSource } from './helpers/loadSource.mjs';
import { loadWorkspaceDomain } from './helpers/loadWorkspaceDomain.mjs';

class Surface {
    listeners = new Map(); frames = new Map(); nextFrame = 0;
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatch(type, patch = {}) {
        const event = { type, pointerId: 1, clientX: 20, clientY: 20, cancelable: true, preventDefault() {}, ...patch };
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(event);
    }
    requestAnimationFrame(fn) { this.frames.set(++this.nextFrame, fn); return this.nextFrame; }
    cancelAnimationFrame(id) { this.frames.delete(id); }
    paint() { const pending = [...this.frames.values()]; this.frames.clear(); pending.forEach(fn => fn()); }
    count() { return [...this.listeners.values()].reduce((sum, items) => sum + items.size, 0); }
}
function controller() {
    const view = new Surface(), document = new Surface(), target = new Surface();
    document.defaultView = view; document.hidden = false; target.ownerDocument = document;
    const log = [];
    const { beginTabDrag } = loadSource('components/layout/tabDrag/pointerSession.ts', {
        './suppressDropClick': { suppressDropClick: () => log.push('suppress') },
    });
    const event = { currentTarget: target, pointerId: 1, clientX: 0, clientY: 0 };
    const session = {
        isValid: () => true, start: () => log.push('start'), move: () => { log.push('move'); },
        resolveDrop: () => { log.push('resolve'); return () => { log.push('commit'); return true; }; },
        cancel: () => log.push('cancel'), dispose: () => log.push('dispose'),
    };
    return { view, document, target, session, event, log, begin: (value = session, start = event) => beginTabDrag(start, value, () => log.push('completed')) };
}

test('shared controller cleans up before committing once and consumes the release click', () => {
    const item = controller(); const stop = item.begin();
    item.view.dispatch('pointermove', { clientX: 7, clientY: 0 }); assert.deepEqual(item.log, []);
    item.view.dispatch('pointermove', { clientX: 8, clientY: 0 });
    item.view.dispatch('pointermove'); assert.equal(item.view.frames.size, 1);
    item.view.paint(); item.view.dispatch('pointerup'); item.view.dispatch('pointerup'); stop();
    assert.deepEqual(item.log, ['start', 'move', 'resolve', 'dispose', 'completed', 'suppress', 'commit']);
    assert.equal(item.view.count(), 0); assert.equal(item.document.count(), 0); assert.equal(item.target.count(), 0);
});

test('one controller arbitrates host and pane gestures in the same window', () => {
    const item = controller(); let secondStarts = 0;
    item.begin(); const stopSecond = item.begin({ ...item.session, start: () => secondStarts++ }, { ...item.event, pointerId: 2 });
    item.view.dispatch('pointermove'); item.view.dispatch('pointermove', { pointerId: 2 });
    stopSecond(); assert.equal(secondStarts, 0);
    item.view.dispatch('pointerup'); assert.equal(item.log.filter(value => value === 'commit').length, 1);
});

test('a refused start releases ownership without canceling an adapter that never began', () => {
    const item = controller();
    item.begin({ ...item.session, start: () => { item.log.push('refused'); return false; } });
    item.view.dispatch('pointermove'); item.view.dispatch('pointerup');
    assert.deepEqual(item.log, ['refused', 'dispose']);
    assert.equal(item.view.count(), 0); assert.equal(item.view.frames.size, 0);
    item.begin(); item.view.dispatch('pointermove'); item.view.dispatch('pointerup');
    assert.equal(item.log.filter(value => value === 'commit').length, 1);
});

test('hidden documents, context menus and stale sessions cancel pending frames without committing', () => {
    for (const reason of ['hidden', 'contextmenu', 'stale']) {
        const item = controller(); let valid = true; item.begin({ ...item.session, isValid: () => valid });
        item.view.dispatch('pointermove');
        if (reason === 'hidden') { item.document.hidden = true; item.document.dispatch('visibilitychange'); }
        else if (reason === 'stale') { valid = false; item.view.paint(); }
        else item.view.dispatch('contextmenu');
        item.view.dispatch('pointerup'); item.view.paint();
        assert.deepEqual(item.log, ['start', 'dispose', 'cancel'], reason);
        assert.equal(item.view.frames.size, 0);
    }
});

test('unmount during start and adapter errors cannot leave capture listeners or a scheduled frame', () => {
    const item = controller(); let stop;
    stop = item.begin({ ...item.session, start: () => { item.log.push('start'); stop(); } });
    item.view.dispatch('pointermove'); assert.equal(item.view.frames.size, 0); assert.equal(item.view.count(), 0);
    assert.deepEqual(item.log, ['start', 'dispose', 'cancel']);
    for (const phase of ['start', 'move', 'resolveDrop']) {
        const failed = controller(); failed.begin({ ...failed.session, [phase]: () => { throw new Error(phase); } });
        assert.throws(() => {
            failed.view.dispatch('pointermove'); failed.view.paint(); failed.view.dispatch('pointerup');
        }, new RegExp(phase));
        assert.equal(failed.view.count(), 0); assert.equal(failed.view.frames.size, 0);
        assert.equal(failed.log.filter(value => value === 'cancel').length, 1);
    }
});

const geometry = loadSource('components/layout/tabDrag/reorder.ts');

test('shared pointer adapter allows native selection triggers but excludes close controls and their icon children', () => {
    let prepared = 0, begun = 0;
    class Element {
        constructor(trigger) { this.trigger = trigger; }
        closest(selector) {
            // Model a target (including its SVG child) within a button ancestor.
            return this.trigger && selector.includes('button:not([data-workspace-tab-trigger])') ? null : this;
        }
    }
    const { useTabDragPointer } = loadSource('components/layout/tabDrag/useTabDragPointer.ts', {
        react: { useRef: current => ({ current }), useCallback: fn => fn, useEffect: () => {} },
        './pointerSession': { beginTabDrag: () => { begun++; return () => {}; } },
    }, { Element });
    const { begin } = useTabDragPointer(() => { prepared++; return {}; });
    for (const trigger of [true, false]) begin({ button: 0, isPrimary: true,
        target: new Element(trigger), currentTarget: {}, clientX: 10, clientY: 10 }, 'pane');
    assert.equal(prepared, 1);
    assert.equal(begun, 1);
});
function stripFixture(pinned = false) {
    const strip = { scrollWidth: 300, clientWidth: 300, scrollLeft: 0, getAttribute: () => 'horizontal',
        getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 30, width: 300 }) };
    const items = ['one', 'two', 'three'].map((id, index) => ({ dataset: { workspaceTabItem: id }, isConnected: true,
        getAttribute: () => String(pinned && index === 0),
        closest: selector => selector === '[data-tab-drag-strip]' ? strip : null,
        getBoundingClientRect: () => ({ left: index * 100, right: index * 100 + 98, top: 0, bottom: 30, width: 98 }) }));
    strip.querySelectorAll = () => items;
    return { strip, items };
}

test('shared hit testing handles gaps and edges, rejects other strips, and preserves pin boundaries', () => {
    const { items } = stripFixture();
    assert.equal(geometry.tabReorderTarget(items[0], { x: 199, y: 15 }).element, items[1]);
    assert.equal(geometry.tabReorderTarget(items[0], { x: 299, y: 15 }).after, true);
    assert.equal(geometry.tabReorderTarget(items[0], { x: 301, y: 15 }), null);
    const pinned = stripFixture(true); assert.equal(geometry.tabReorderTarget(pinned.items[0], { x: 180, y: 15 }), null);
    items[2].closest = () => ({}); assert.equal(geometry.tabReorderTarget(items[0], { x: 250, y: 15 }).element, items[1]);
});

test('edge scrolling repeats only while a strip can scroll and never outside its bounds', () => {
    const { strip, items } = stripFixture(); let offset = 0;
    strip.scrollWidth = 400;
    Object.defineProperty(strip, 'scrollLeft', { get: () => offset, set: value => { offset = Math.max(0, Math.min(100, value)); } });
    assert.equal(geometry.scrollTabStrip(items[0], { x: 10, y: 15 }), false);
    assert.equal(geometry.scrollTabStrip(items[0], { x: 290, y: 15 }), true); assert.equal(offset, 8);
    assert.equal(geometry.scrollTabStrip(items[0], { x: 320, y: 15 }), false);
    offset = 100; assert.equal(geometry.scrollTabStrip(items[0], { x: 290, y: 15 }), false);
});

test('host reorder accepts both halves of adjacent tabs and strip padding in either direction', () => {
    const { strip, items } = stripFixture();
    items.forEach((item, index) => { item.getBoundingClientRect = () => ({
        left: index * 100, right: index * 100 + 98, top: 4, bottom: 26, width: 98,
    }); });
    for (const [from, to] of [[0, 1], [1, 0], [1, 2], [2, 1], [0, 2], [2, 0]]) {
        for (const fraction of [0.25, 0.75]) for (const y of [1, 15, 29]) {
            const target = geometry.tabReorderTarget(items[from], { x: to * 100 + 98 * fraction, y }, 'reorder');
            assert.equal(target?.element, items[to]);
            assert.equal(geometry.reorderIndex(from, to, target.after), to);
        }
    }
    assert.equal(geometry.tabReorderTarget(items[0], { x: 125, y: -1 }, 'reorder'), null);
    assert.equal(geometry.tabReorderTarget(items[0], { x: 125, y: 31 }, 'reorder'), null);
    assert.equal(geometry.tabReorderTarget(items[0], { x: 25, y: 15 }, 'reorder'), null);
    const pinned = stripFixture(true);
    assert.equal(geometry.tabReorderTarget(pinned.items[0], { x: 125, y: 15 }, 'reorder'), null);
    items[1].getBoundingClientRect = () => ({ left: 100, right: 198, top: 4, bottom: 4, width: 98 });
    assert.equal(geometry.tabReorderTarget(items[0], { x: 125, y: 1 }, 'reorder'), null);
    // Pane insertion still distinguishes the two halves instead of replacing a whole slot.
    assert.equal(geometry.tabReorderTarget(items[0], { x: 225, y: 1 }).after, false);
    assert.equal(geometry.tabReorderTarget(items[0], { x: 275, y: 29 }).after, true);
    strip.querySelectorAll = () => [];
    assert.equal(geometry.tabReorderTarget(items[0], { x: 125, y: 15 }, 'reorder'), null);
});

test('host adapter uses stable IDs once, preserves activation, and rejects changed order/pins/readiness', () => {
    for (const change of ['none', 'order', 'pin', 'active', 'readiness']) {
        const { strip, items } = stripFixture(); const calls = []; const ref = { current: null };
        const options = { tabs: items.map(item => ({ id: item.dataset.workspaceTabItem })), activeTabId: 'one',
            getStrip: () => strip, canDrag: () => true, onReorder: (...args) => { calls.push(args); } };
        items[0].closest = selector => selector === '[data-workspace-tab-item]' ? items[0] : strip;
        const { useWorkspaceTabDrag } = loadSource('components/layout/tabDrag/useWorkspaceTabDrag.ts', {
            react: { useRef: () => ref }, './useTabDragPointer': { useTabDragPointer: prepare => prepare },
            '../../../features/workspace/domain/mainTabPresentation': loadWorkspaceDomain('features/workspace/domain/mainTabPresentation.ts'),
            './preview': { createTabDragPreview: () => null }, './reorder': geometry,
        });
        const prepare = useWorkspaceTabDrag(options);
        const session = prepare(items[0], 'one', { x: 10, y: 15 }); session.start();
        const action = session.resolveDrop({ x: 125, y: 15 }); session.dispose();
        if (change === 'order') options.tabs.reverse();
        if (change === 'pin') options.tabs[0].presentation = { version: 1, pinned: true };
        if (change === 'active') options.activeTabId = 'two';
        if (change === 'readiness') options.canDrag = () => false;
        assert.equal(action(), change === 'none', change);
        assert.deepEqual(calls, change === 'none' ? [['one', 'two']] : [], change);
    }
});

test('vertical chrome uses the same hit, feedback and scrolling helpers without changing horizontal sorting', () => {
    const { strip, items } = stripFixture();
    strip.getAttribute = () => 'vertical';
    strip.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 90, width: 100, height: 90 });
    items.forEach((item, index) => {
        item.getBoundingClientRect = () => ({ left: 0, right: 100, top: index * 30, bottom: index * 30 + 28, width: 100, height: 28 });
    });
    for (const [from, to] of [[0, 1], [1, 0], [2, 0], [0, 2]]) for (const x of [1, 50, 99]) {
        const target = geometry.tabReorderTarget(items[from], { x, y: to * 30 + 14 }, 'reorder');
        assert.equal(target.element, items[to]);
        assert.equal(geometry.reorderIndex(from, to, target.after), to);
    }
    assert.equal(geometry.tabReorderTarget(items[0], { x: 50, y: 33 }).after, false);
    assert.equal(geometry.tabReorderTarget(items[0], { x: 50, y: 55 }).after, true);
    assert.equal(geometry.tabReorderTarget(items[0], { x: 101, y: 50 }), null);
    strip.scrollHeight = 150; strip.clientHeight = 90;
    let offset = 0;
    Object.defineProperty(strip, 'scrollTop', { get: () => offset, set: value => { offset = Math.max(0, Math.min(60, value)); } });
    assert.equal(geometry.scrollTabStrip(items[0], { x: 50, y: 85 }), true); assert.equal(offset, 8);
    assert.equal(geometry.scrollTabStrip(items[0], { x: 101, y: 85 }), false);
    offset = 60; assert.equal(geometry.scrollTabStrip(items[0], { x: 50, y: 85 }), false);
});
