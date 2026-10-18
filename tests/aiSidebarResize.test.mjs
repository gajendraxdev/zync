import assert from 'node:assert/strict';
import { clampAiSidebarWidth } from '../.tmp-agent-tests/src/components/ai/useAiSidebarWidth.js';
import * as sharedResize from '../.tmp-agent-tests/src/components/layout/sidebar/useSidebarResize.js';
import { loadSource } from './helpers/loadSource.mjs';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
const sidebarStyles = loadSource('components/ui/sidebarStyles.ts');

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest('clamps sidebar width to minimum', () => {
  assert.equal(clampAiSidebarWidth(100), 250);
});

runTest('clamps sidebar width to maximum', () => {
  assert.equal(clampAiSidebarWidth(1200), 800);
});

runTest('preserves widths inside allowed range', () => {
  assert.equal(clampAiSidebarWidth(420), 420);
});

runTest('normalizes fractional and invalid saved widths', () => {
  assert.equal(clampAiSidebarWidth(420.6), 421);
  assert.equal(clampAiSidebarWidth(Number.NaN), 300);
  assert.equal(clampAiSidebarWidth(Number.POSITIVE_INFINITY), 300);
});

for (const limits of [{ minWidth: 200, maxWidth: 600, defaultWidth: 288 }, { minWidth: 250, maxWidth: 800, defaultWidth: 300 }]) {
  for (const side of ['left', 'right']) {
    runTest(`shared drag contract for ${side} sidebar (${limits.maxWidth}px limit)`, () => {
      const changes = [], commits = [], events = [], frames = new Map(), effects = [], listeners = new Map();
      let nextFrame = 0, captured = false, failCommit = false;
      const body = { style: { cursor: 'text' } };
      const { useSidebarResize } = loadSource('components/layout/sidebar/useSidebarResize.ts', {
        react: { useCallback: fn => fn, useRef: value => ({ current: value }),
          useState: value => [value, next => changes.push(next)], useEffect: effect => effects.push(effect) },
      }, {
        document: { body }, window: { dispatchEvent: event => events.push(event.type),
          addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) },
        CustomEvent: class { constructor(type) { this.type = type; } },
        requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
        cancelAnimationFrame: id => frames.delete(id),
      });
      const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
      const { handlers, sidebarRef, contentRef } = useSidebarResize(300, value => {
        commits.push(value); if (failCommit) throw Error('save failure');
      }, side, limits);
      const cleanups = effects.map(effect => effect()).filter(Boolean);
      changes.length = 0;
      const style = { setProperty(name, value) { this[name] = value; } };
      sidebarRef.current = { style };
      const contentStyle = {};
      contentRef.current = { style: contentStyle };
      const attrs = {};
      const node = { parentElement: { getBoundingClientRect: () => ({ width: 300 }) },
        setPointerCapture() { captured = true; }, hasPointerCapture: () => captured,
        releasePointerCapture() { captured = false; }, setAttribute(name, value) { attrs[name] = value; } };
      const event = { clientX: 500, button: 0, isPrimary: true, pointerId: 3, currentTarget: node, preventDefault() {} };
      handlers.onPointerDown({ ...event, button: 2 }); assert.equal(captured, false);
      handlers.onPointerDown({ ...event, isPrimary: false }); assert.equal(captured, false);
      handlers.onPointerDown(event); assert.equal(captured, true);
      handlers.onPointerMove({ ...event, pointerId: 99, clientX: 900 }); assert.equal(frames.size, 0);
      handlers.onPointerMove(event); flush(); assert.equal(style.width, '300px', 'grab point must not shift the edge');
      const delta = side === 'right' ? -1 : 1;
      for (let distance = 1; distance <= 20; distance++) handlers.onPointerMove({ ...event, clientX: 500 + delta * (distance + 0.25) });
      assert.equal(frames.size, 1, 'pointer work is coalesced'); flush();
      assert.equal(style.width, '320.25px'); assert.equal(contentStyle.width, '320.25px');
      assert.equal(contentStyle.minWidth, '320.25px');
      assert.equal(style['--sidebar-width'], undefined, 'live sizing must not invalidate inherited styles');
      assert.equal(attrs['aria-valuenow'], '320'); assert.deepEqual(changes, [true]); assert.deepEqual(commits, []);
      // Release before the last queued paint: latest width still wins, exactly one save.
      handlers.onPointerMove({ ...event, clientX: 500 + delta * 40.75 });
      handlers.onPointerUp(event); handlers.onLostPointerCapture(event); handlers.onPointerUp(event);
      assert.deepEqual(commits, [341]); assert.equal(style.width, '341px'); assert.equal(body.style.cursor, 'text');
      assert.equal(contentStyle.width, '341px'); assert.equal(contentStyle.minWidth, '341px');
      assert.equal(captured, false); assert.equal(frames.size, 1); flush(); assert.equal(changes.at(-1), false);
      handlers.onKeyDown({ key: side === 'right' ? 'ArrowLeft' : 'ArrowRight', preventDefault() {} });
      assert.equal(commits.at(-1), 357);
      handlers.onKeyDown({ key: 'End', preventDefault() {} }); assert.equal(commits.at(-1), limits.maxWidth);
      handlers.onKeyDown({ key: 'Home', preventDefault() {} }); assert.equal(commits.at(-1), limits.minWidth);
      handlers.onPointerDown(event); handlers.onPointerMove({ ...event, clientX: 500 + delta * 2000 });
      handlers.onPointerCancel(event); assert.equal(commits.at(-1), limits.maxWidth); flush();
      handlers.onPointerDown(event); handlers.onPointerMove({ ...event, clientX: 500 - delta * 2000 });
      listeners.get('blur')(); assert.equal(commits.at(-1), limits.minWidth); flush();
      failCommit = true;
      handlers.onPointerDown(event); handlers.onPointerMove({ ...event, clientX: 500 + delta * 25 });
      assert.throws(() => handlers.onPointerUp(event), /save failure/);
      assert.equal(captured, false); assert.equal(body.style.cursor, 'text');
      assert.equal(events.at(-1), 'zync:layout-transition-end'); flush(); assert.equal(changes.at(-1), false);
      failCommit = false;
      const savedCount = commits.length;
      handlers.onPointerDown(event); handlers.onPointerMove({ ...event, clientX: 500 + delta * 15 });
      cleanups.forEach(fn => fn());
      assert.equal(commits.length, savedCount, 'unmount does not save'); assert.equal(frames.size, 0);
      assert.equal(captured, false); assert.equal(listeners.size, 0); assert.equal(body.style.cursor, 'text');
      assert.equal(events.filter(name => name.endsWith('start')).length, events.filter(name => name.endsWith('end')).length);
    });
  }
}

runTest('AI and primary sidebar use one shell without duplicated pointer handlers', () => {
  const ai = readFileSync(new URL('../src/components/ai/AiSidebar.tsx', import.meta.url), 'utf8');
  const primary = readFileSync(new URL('../src/components/layout/Sidebar.tsx', import.meta.url), 'utf8');
  assert.match(ai, /<SidebarChrome/); assert.match(primary, /<SidebarChrome/);
  assert.match(ai, /<SidebarContent/); assert.match(primary, /<SidebarContent/);
  assert.doesNotMatch(ai + primary, /var\(--sidebar-width\)/);
  assert.match(ai, /widthLimits=\{AI_SIDEBAR_WIDTH_LIMITS\}/);
  assert.doesNotMatch(ai, /useAiSidebarResize|resizeHandlers|sidebarOuterRef|motion\.aside/);
});

runTest('shared content owns its pixel width and retains it while the shell collapses', () => {
  const { SidebarChrome, SidebarContent } = loadSource('components/layout/sidebar/SidebarChrome.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime,
    '../../../lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../../ui/controlStyles': { CONTROL_INSET_FOCUS_CLASSES: 'focus-inset' },
    '../../ui/sidebarStyles': sidebarStyles,
    '../../ui/LayoutMotion': { useLayoutWidthTransition() {} },
    './useSidebarResize': { ...sharedResize, useSidebarResize: () => ({ width: 300, isResizing: false,
      sidebarRef: { current: null }, contentRef: { current: null }, handlers: {} }) },
  });
  for (const collapsed of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(SidebarChrome, {
      position: 'left', savedWidth: 300, collapsed, onResize() {},
    }, React.createElement(SidebarContent, { className: 'content' }, React.createElement('input', { defaultValue: 'retained' }))));
    assert.match(html, /data-sidebar-content="true"[^>]*style="width:300px;min-width:300px"/);
    assert.match(html, new RegExp(`style="width:${collapsed ? 0 : 300}(?:px)?;order:0;`));
    assert.doesNotMatch(html, /--sidebar-width/);
    assert.equal(html.includes('role="separator"'), !collapsed);
    assert.equal(html.includes('inert=""'), collapsed);
    assert.ok(html.includes(sidebarStyles.SIDEBAR_WIDTH_TRANSITION_CLASSES));
  }
  assert.throws(() => renderToStaticMarkup(React.createElement(SidebarContent, {}, 'orphan')), /must be inside SidebarChrome/);
});

runTest('Files drawers retain fixed content width, zero collapsed width and shared motion on both sides', () => {
  const { FileSideDrawer } = loadSource('components/file-manager/FileSideDrawer.tsx', {
    react: React, 'react/jsx-runtime': jsxRuntime,
    '../../lib/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
    '../ui/sidebarStyles': sidebarStyles,
    '../ui/LayoutMotion': { useLayoutWidthTransition() {} },
  });
  for (const side of ['left', 'right']) for (const open of [false, true]) {
    const html = renderToStaticMarkup(React.createElement(FileSideDrawer, { side, open, width: 184 }, 'Places'));
    assert.match(html, /data-file-drawer-content=""[^>]*style="width:184px;min-width:184px"/);
    assert.match(html, new RegExp(`style="width:${open ? 184 : 0}(?:px)?"`));
    assert.ok(html.includes(sidebarStyles.SIDEBAR_WIDTH_TRANSITION_CLASSES));
    assert.equal(html.includes('inert=""'), !open);
    assert.doesNotMatch(html, /opacity-0/);
  }
});

runTest('AI persistence retains its key, bounds and storage-failure fallback', () => {
  for (const failStorage of [false, true]) {
    const changes = [], saves = [];
    const { useAiSidebarWidth } = loadSource('components/ai/useAiSidebarWidth.ts', {
      react: { useCallback: fn => fn, useState: initial => [initial(), value => changes.push(value)] },
      '../layout/sidebar/useSidebarResize.js': sharedResize,
    }, { localStorage: {
      getItem(key) { assert.equal(key, 'zync-ai-sidebar-width'); if (failStorage) throw Error('Unavailable'); return '450'; },
      setItem(key, value) { if (failStorage) throw Error('Unavailable'); saves.push([key, value]); },
    } });
    const { width, saveWidth } = useAiSidebarWidth();
    assert.equal(width, failStorage ? 300 : 450);
    saveWidth(450.75); assert.deepEqual(changes, [451]);
    assert.deepEqual(saves, failStorage ? [] : [['zync-ai-sidebar-width', '451']]);
  }
});

console.log('AI sidebar resize tests passed.');
