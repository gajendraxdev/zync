import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaneHeader } from '../.tmp-agent-tests/src/components/workspace/PaneHeader.js';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';

const props = { label: 'My shell', defaultTitle: 'Shell 1', icon: h('svg'), onPointerDown() {}, onRename() {}, onClose() {} };

test('pane header names separate native actions and retains the canonical title', () => {
    const html = renderToStaticMarkup(h(TooltipProvider, {}, h(PaneHeader, props)));
    assert.match(html, /<div(?=[^>]*role="group")(?=[^>]*aria-label="My shell pane controls")[^>]*>/);
    assert.doesNotMatch(html, /title="Shell 1"/);
    assert.ok(PaneHeader(props).props.children.some(child => child?.props?.content === 'My shell — Shell 1'));
    assert.match(html, /tabindex="0"/);
    assert.doesNotMatch(html, /aria-label="Rename My shell pane"/);
    assert.match(html, /aria-label="Close My shell pane"/);
    assert.equal((html.match(/type="button"/g) ?? []).length, 1);
});

test('close, maximize and restore use Zync tooltips on the named native actions', () => {
    for (const maximized of [false, true]) {
        const header = PaneHeader({ ...props, maximized, onToggleMaximize() {} });
        for (const name of [`${maximized ? 'Restore' : 'Maximize'} My shell pane`, 'Close My shell pane']) {
            const tooltip = header.props.children.find(child => child?.props?.children?.props?.label === name);
            assert.ok(tooltip, `${name}: shared tooltip wraps its native action`);
            assert.ok(tooltip.props.content.includes(maximized && name.startsWith('Restore') ? 'Restore' : name.split(' ')[0]));
            assert.equal(tooltip.props.children.props.title, undefined);
        }
        const html = renderToStaticMarkup(h(TooltipProvider, {}, h(PaneHeader, { ...props, maximized, onToggleMaximize() {} })));
        assert.doesNotMatch(html, /\btitle=/);
        assert.equal((html.match(/type="button"/g) ?? []).length, 2, 'tooltips add no focusable wrapper buttons');
    }
});

test('pane header actions are isolated from drag, select and form submission', () => {
    let renames = 0, closes = 0, stops = 0;
    const header = PaneHeader({ ...props, onRename() { renames++; }, onClose() { closes++; } });
    const buttons = header.props.children.map(child => child?.props?.children).filter(child => child?.props?.label);
    for (const button of buttons) {
        button.props.onPointerDown({ stopPropagation() { stops++; } });
        button.props.onClick({ stopPropagation() { stops++; } });
    }
    assert.equal(stops, 2);
    assert.equal(renames, 0);
    assert.equal(closes, 1);
});

test('F2 provides a scoped rename shortcut without claiming modified shortcuts', () => {
    let renames = 0, prevented = 0, stopped = 0;
    const header = PaneHeader({ ...props, onRename() { renames++; } });
    const key = { key: 'F2', preventDefault() { prevented++; }, stopPropagation() { stopped++; } };
    header.props.onKeyDown(key);
    for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) header.props.onKeyDown({ ...key, [modifier]: true });
    header.props.onKeyDown({ ...key, key: 'F3' });
    assert.equal(renames, 1);
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
});

test('maximize and restore are named keyboard buttons isolated from pane dragging', () => {
    for (const maximized of [false, true]) {
        let calls = 0, stops = 0;
        const onToggleMaximize = () => { calls++; };
        const html = renderToStaticMarkup(h(TooltipProvider, {}, h(PaneHeader, { ...props, maximized, onToggleMaximize })));
        assert.match(html, new RegExp(`aria-label="${maximized ? 'Restore' : 'Maximize'} My shell pane"`));
        assert.equal((html.match(/type="button"/g) ?? []).length, 2);
        const button = PaneHeader({ ...props, maximized, onToggleMaximize }).props.children.map(child => child?.props?.children)
            .find(child => child?.props?.label?.startsWith(maximized ? 'Restore ' : 'Maximize '));
        button.props.onPointerDown({ stopPropagation() { stops++; } });
        button.props.onClick({ stopPropagation() { stops++; } });
        assert.equal(calls, 1); assert.equal(stops, 2);
    }
});

test('docked headers identify location and focus with a contained accent, not an overflowing ring', () => {
    for (const dockRegion of ['primary-sidebar', 'secondary-sidebar', 'bottom-panel']) for (const dockFocused of [false, true]) {
        const header = PaneHeader({ ...props, dockRegion, dockFocused });
        assert.equal(header.props['data-pane-dock'], dockRegion);
        assert.equal(header.props['data-dock-focused'], dockFocused);
        assert.equal(header.props.className.includes('after:bg-app-accent'), dockFocused);
        assert.doesNotMatch(header.props.className, /ring|outline/);
        assert.match(header.props['aria-label'], /Docked (left|right|bottom)/);
        const html = renderToStaticMarkup(h(TooltipProvider, {}, h(PaneHeader, { ...props, dockRegion, dockFocused })));
        assert.match(html, /data-dock-indicator/);
        assert.doesNotMatch(html, /Return .* to tabs/, 'no action without an authorized caller');
    }
});

test('Return to tabs uses Zync tooltip and an isolated, optionally disabled native button', () => {
    for (const disabled of [false, true]) {
        let calls = 0, stops = 0;
        const dockProps = { ...props, dockRegion: 'secondary-sidebar', returnToTabsDisabled: disabled, onReturnToTabs() { calls++; } };
        const header = PaneHeader(dockProps);
        const tooltip = header.props.children.find(child => child?.props?.content?.startsWith('Return to tabs'));
        assert.equal(tooltip.props.disabledTrigger, disabled);
        const action = tooltip.props.children;
        assert.equal(action.props.disabled, disabled); assert.equal(action.props.title, undefined);
        action.props.onPointerDown({ stopPropagation() { stops++; } });
        if (!disabled) action.props.onClick({ stopPropagation() { stops++; } });
        assert.equal(calls, disabled ? 0 : 1); assert.equal(stops, disabled ? 1 : 2);
        const html = renderToStaticMarkup(h(TooltipProvider, {}, h(PaneHeader, dockProps)));
        assert.match(html, /aria-label="Return My shell to tabs"/);
        assert.equal((html.match(/type="button"/g) ?? []).length, 2);
        assert.equal(html.includes('disabled=""'), disabled);
    }
});

test('header context-menu keyboard access is scoped to the header, not nested close controls', () => {
    let opened = 0, prevented = 0;
    const header = PaneHeader({ ...props, onOpenContextMenu() { opened++; } });
    const target = {};
    const preventDefault = () => { prevented++; };
    header.props.onKeyDown({ key: 'F10', shiftKey: true, currentTarget: target, target, preventDefault });
    header.props.onKeyDown({ key: 'ContextMenu', currentTarget: target, target, preventDefault });
    header.props.onKeyDown({ key: 'ContextMenu', currentTarget: target, target: {} });
    assert.equal(opened, 2);
    assert.equal(prevented, 2);
    PaneHeader(props).props.onKeyDown({ key: 'ContextMenu', currentTarget: target, target, preventDefault });
    assert.equal(prevented, 2, 'native menu remains available when no custom handler exists');
});
