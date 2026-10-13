import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as React from 'react';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function source(file, dependencies, globals = {}) {
    const module = { exports: {} };
    const { outputText } = ts.transpileModule(readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
    });
    runInNewContext(outputText, { module, exports: module.exports, ...globals,
        require: name => typeof dependencies === 'function' ? dependencies(name)
            : Object.hasOwn(dependencies, name) ? dependencies[name] : require(name) });
    return module.exports;
}
const modules = new Map();
function pure(file) {
    if (modules.has(file)) return modules.get(file);
    const result = {}; modules.set(file, result);
    Object.assign(result, source(file, name => {
        assert.ok(name.startsWith('.'), `Unexpected service dependency: ${name}`);
        const base = posix.normalize(posix.join(posix.dirname(file), name));
        return pure(existsSync(new URL(`../src/${base}.ts`, import.meta.url)) ? `${base}.ts` : `${base}/index.ts`);
    }));
    return result;
}
const layout = pure('lib/paneLayout/index.ts');
const regions = pure('lib/paneLayout/regions.ts');

/** Deterministic effects/timers isolate native input; actual geometry is checked in the browser fixture. */
function hooks() {
    let cursor = 0; let scheduled = [];
    const slots = [];
    const slot = initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return index; };
    const effect = (run, deps) => {
        const index = slot({}); const previous = slots[index];
        if (!deps || !previous.deps || deps.some((item, i) => !Object.is(item, previous.deps[i]))) {
            scheduled.push(() => { previous.cleanup?.(); slots[index] = { deps, cleanup: run() }; });
        }
    };
    return {
        react: { ...React, useRef: initial => slots[slot({ current: initial })],
            useState: initial => { const index = slot(initial); return [slots[index], value => {
                slots[index] = typeof value === 'function' ? value(slots[index]) : value;
            }]; }, useCallback: (fn, deps) => {
                const index = slot({}); const previous = slots[index];
                if (!previous.deps || deps.some((item, i) => !Object.is(item, previous.deps[i]))) slots[index] = { deps, fn };
                return slots[index].fn;
            }, useEffect: effect, useLayoutEffect: effect },
        begin: () => { cursor = 0; scheduled = []; }, flush: () => scheduled.forEach(run => run()),
        dispose: () => slots.forEach(item => item?.cleanup?.()),
    };
}
class Target {
    listeners = new Map(); captured = new Set();
    focused = false;
    focus() { this.focused = true; }
    addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
    removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
    dispatchEvent(event) { for (const fn of this.listeners.get(event.type) ?? []) fn(event); }
    setPointerCapture(id) { this.captured.add(id); }
    hasPointerCapture(id) { return this.captured.has(id); }
    releasePointerCapture(id) { this.captured.delete(id); }
    closest() { return this; }
    clientWidth = 1000; clientHeight = 500;
    getBoundingClientRect() { return { left: 0, top: 0 }; }
}
const event = (type, data = {}) => ({ type, preventDefault() {}, stopPropagation() {}, ...data });
function divider(overrides = {}) {
    const machine = hooks(); const window = new Target(); const node = new Target();
    const timers = new Map(); let timerId = 0; const holds = new Set(); const values = [];
    let commits = 0; let cancels = 0; let resets = 0;
    window.setTimeout = fn => { timers.set(++timerId, fn); return timerId; };
    window.clearTimeout = id => timers.delete(id);
    const { PaneDivider } = source('components/terminal/PaneDivider.tsx', {
        react: machine.react, '../../lib/utils': { cn: () => '' }, '../../lib/paneLayout': layout,
        '../../lib/terminal/terminalFit': {
            beginPaneDividerDrag: () => { const hold = Symbol(); holds.add(hold); return hold; },
            endPaneDividerDrag: hold => holds.delete(hold),
        },
    }, { window, HTMLElement: Target, Event });
    let props = { direction: 'horizontal', firstRatio: 0.24, minRatio: 0.15, maxRatio: 0.35,
        onDrag: value => values.push(value), onDragEnd: () => commits++, onCancel: () => cancels++,
        onEqualize: () => resets++, ...overrides };
    let tree;
    const render = (patch = {}) => {
        props = { ...props, ...patch }; machine.begin(); tree = PaneDivider(props);
        tree.props.ref.current = node; machine.flush(); return tree;
    };
    render();
    return { render, node, window, values, holds, timers,
        stats: () => ({ commits, cancels, resets }),
        key: key => tree.props.onKeyDown(event('keydown', { key })),
        down: (patch = {}) => tree.props.onPointerDown(event('pointerdown', { currentTarget: node, button: 0, isPrimary: true, pointerId: 1, detail: 1, ...patch })),
        wheel: (patch = {}) => node.dispatchEvent(event('wheel', { deltaX: 0, deltaY: 20, deltaMode: 0, ...patch })),
        settle: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
        dispose: machine.dispose,
    };
}

test('region sash constrains rapid keyboard input and exposes region-specific semantics', () => {
    const subject = divider({ label: 'Resize primary sidebar', valueText: '24% width' });
    const node = subject.render();
    assert.equal(node.props['aria-label'], 'Resize primary sidebar');
    assert.equal(node.props['aria-valuemin'], 15); assert.equal(node.props['aria-valuemax'], 35);
    subject.key('ArrowRight'); subject.key('ArrowRight'); subject.key('ArrowRight');
    assert.equal(subject.values.at(-1), 0.35); assert.equal(subject.stats().commits, 3);
    assert.equal(subject.holds.size, 0); subject.dispose();
});
test('pointer capture filters unrelated pointers, clamps and commits once on release', () => {
    const subject = divider(); subject.down({ isPrimary: false }); assert.equal(subject.holds.size, 0);
    subject.down(); assert.equal(subject.node.hasPointerCapture(1), true);
    assert.equal(subject.node.focused, true, 'Region drag gives Escape a host-document focus target');
    subject.window.dispatchEvent(event('pointermove', { pointerId: 2, clientX: 300 }));
    subject.window.dispatchEvent(event('pointerup', { pointerId: 2 })); assert.equal(subject.values.length, 0);
    subject.window.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 700 }));
    assert.equal(subject.values.at(-1), 0.35); assert.equal(subject.stats().commits, 0);
    subject.window.dispatchEvent(event('pointerup', { pointerId: 1 }));
    assert.equal(subject.stats().commits, 1); assert.equal(subject.holds.size, 0);
    assert.equal(subject.node.captured.size, 0); assert.equal(subject.window.listeners.get('pointermove').size, 0);
    subject.dispose();
});
test('a rejected resize cannot become the next keyboard or wheel baseline', () => {
    const subject = divider({ onDragEnd: () => false });
    subject.key('ArrowRight'); subject.key('ArrowRight');
    assert.ok(subject.values.every(value => Math.abs(value - 0.29) < 1e-12));
    subject.wheel(); subject.settle(); subject.key('ArrowRight');
    assert.ok(Math.abs(subject.values.at(-1) - 0.29) < 1e-12); subject.dispose();
});
test('Escape before a preview render discards accumulated wheel input and restores the next input baseline', () => {
    const subject = divider(); subject.wheel(); subject.render(); subject.wheel();
    assert.ok(subject.values[1] > subject.values[0], 'Held-state renders cannot erase accumulated input');
    subject.key('Escape'); assert.equal(subject.stats().cancels, 1); assert.equal(subject.timers.size, 0);
    subject.key('ArrowRight'); assert.ok(Math.abs(subject.values.at(-1) - 0.29) < 1e-12);
    assert.equal(subject.stats().commits, 1); assert.equal(subject.holds.size, 0); subject.dispose();
});
test('wheel settling saves once, while reset, blur, pointer cancel and unmount clean up without saving drafts', () => {
    const settled = divider(); settled.wheel(); settled.wheel(); settled.settle();
    assert.equal(settled.stats().commits, 1); assert.equal(settled.holds.size, 0); settled.dispose();
    for (const finish of ['Enter', 'blur', 'pointercancel', 'unmount']) {
        const subject = divider();
        if (finish === 'pointercancel') {
            subject.down(); subject.window.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 330 }));
            subject.window.dispatchEvent(event('pointercancel', { pointerId: 1 }));
        } else {
            subject.wheel();
            if (finish === 'Enter') subject.key('Enter');
            else if (finish === 'blur') subject.window.dispatchEvent(event('blur'));
            else subject.dispose();
        }
        assert.equal(subject.stats().commits, 0, finish); assert.equal(subject.stats().cancels, 1, finish);
        assert.equal(subject.holds.size, 0, finish); assert.equal(subject.timers.size, 0, finish);
        assert.equal(subject.stats().resets, finish === 'Enter' ? 1 : 0); subject.dispose();
    }
});
test('Escape cancels a pointer gesture even when the handle does not own focus', () => {
    const subject = divider(); subject.down();
    subject.window.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 330 }));
    subject.window.dispatchEvent(event('keydown', { key: 'Escape' }));
    assert.equal(subject.stats().commits, 0); assert.equal(subject.stats().cancels, 1);
    assert.equal(subject.node.captured.size, 0); assert.equal(subject.holds.size, 0);
    subject.dispose(); assert.equal(subject.window.listeners.get('keydown').size, 0);
});
test('existing split callers retain commit-on-pointer-cancel behavior without opting into rollback', () => {
    const subject = divider({ onCancel: undefined, minRatio: undefined, maxRatio: undefined });
    subject.down(); subject.window.dispatchEvent(event('pointermove', { pointerId: 1, clientX: 600 }));
    assert.equal(subject.node.focused, false, 'Existing split callers keep their focus policy');
    subject.window.dispatchEvent(event('pointercancel', { pointerId: 1 }));
    assert.equal(subject.stats().commits, 1); assert.equal(subject.values.at(-1), 0.6); subject.dispose();
});

function frame() {
    const machine = hooks(); const frames = new Map(); let id = 0;
    const saves = []; let refusals = 0; let accepts = true;
    const PaneDivider = () => null; const PaneRegionFrame = () => null;
    const { ResizablePaneRegionFrame } = source('components/workspace/ResizablePaneRegionFrame.tsx', {
        react: machine.react, '../../lib/paneLayout/regions': regions,
        '../terminal/PaneDivider': { PaneDivider }, './PaneRegionFrame': { PaneRegionFrame },
    }, { requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id) });
    let props = { regions: new Set(['workspace', 'primary-sidebar', 'secondary-sidebar', 'bottom-panel']),
        sizes: {}, renderRegion: () => null, onResize: (region, size) => { saves.push([region, size]); return accepts; },
        onResizeRefused: () => refusals++ };
    const render = (patch = {}) => { props = { ...props, ...patch }; machine.begin(); const tree = ResizablePaneRegionFrame(props); machine.flush(); return tree; };
    const sash = name => React.Children.toArray(render().props.children).find(child => child.props.label === `Resize ${name}`).props;
    return { render, sash, saves, frames, dispose: machine.dispose, refusals: () => refusals,
        refuse: () => { accepts = false; }, paint: () => { for (const [id, fn] of [...frames]) { frames.delete(id); fn(); } } };
}
test('region preview coalesces without persistence; release commits exactly the addressed fraction', () => {
    const subject = frame(); const sash = subject.sash('primary sidebar');
    sash.onDrag(0.28); sash.onDrag(0.33); assert.equal(subject.frames.size, 1); assert.equal(subject.saves.length, 0);
    subject.paint(); assert.equal(subject.render().props.sizes.primary, 0.33);
    sash.onDragEnd(); assert.deepEqual(subject.saves, [['primary-sidebar', 0.33]]);
    assert.equal(subject.render().props.sizes.primary, 0.24); subject.dispose();
});
test('secondary and bottom coordinates invert, bound, reset and report refused commits', () => {
    const subject = frame(); const right = subject.sash('secondary sidebar');
    right.onDrag(0.68); right.onDragEnd(); assert.ok(Math.abs(subject.saves[0][1] - 0.32) < 1e-12);
    const bottom = subject.sash('bottom panel'); bottom.onDrag(0.9); bottom.onDragEnd();
    assert.deepEqual(subject.saves[1], ['bottom-panel', 0.2]);
    subject.refuse(); bottom.onEqualize(); assert.deepEqual(subject.saves[2], ['bottom-panel', 0.32]);
    assert.equal(subject.refusals(), 1); assert.equal(subject.frames.size, 0); subject.dispose();
});
test('cancellation or removal discards drafts, and another sash cannot commit a foreign draft', () => {
    const subject = frame(); const left = subject.sash('primary sidebar'); const bottom = subject.sash('bottom panel');
    left.onDrag(0.3); bottom.onDragEnd(); assert.equal(subject.saves.length, 0);
    bottom.onCancel(); assert.equal(subject.frames.size, 1); left.onCancel(); assert.equal(subject.frames.size, 0);
    left.onDrag(0.3); subject.paint();
    const tree = subject.render({ regions: new Set(['workspace']) });
    assert.equal(React.Children.count(tree.props.children), 0); assert.equal(tree.props.sizes.primary, 0.24);
    subject.dispose(); assert.equal(subject.saves.length, 0); assert.equal(subject.frames.size, 0);
});
