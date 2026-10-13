import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement as h } from 'react';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { renderToStaticMarkup } from 'react-dom/server';
import rehypeRaw from 'rehype-raw';
import { WorkspaceTabList } from '../.tmp-agent-tests/src/components/layout/WorkspaceTabList.js';

import { workspaceTabContextMenu } from '../.tmp-agent-tests/src/components/layout/workspaceTabContextMenu.js';

const tabs = [
    { id: 'host', type: 'connection', title: 'Production server', displayAlias: 'Release logs', connectionId: 'server', view: 'terminal' },
    { id: 'public', type: 'public-urls', title: 'Public URLs', displayAlias: 'Preview links', view: 'terminal' },
    { id: 'local', type: 'connection', title: 'Local Terminal', connectionId: 'local', view: 'terminal' },
];
const descendants = node => [node, ...(node.children ?? []).flatMap(descendants)];
function render(activeTabId = 'host', items = tabs) {
    const html = renderToStaticMarkup(h(TooltipProvider, {}, h(WorkspaceTabList, {
        tabs: items, activeTabId,
        onActivate: () => assert.fail('render must not activate'),
        onClose: () => assert.fail('render must not close'),
        onDisconnect: () => assert.fail('render must not disconnect'),
        onRename: () => assert.fail('render must not rename'),
        onReorder: () => assert.fail('render must not reorder'),
        canDisconnect: tab => tab.id === 'host',
        renderIcon: tab => h('span', { 'data-canonical-icon': tab.type }),
    })));
    const tree = rehypeRaw()({ type: 'root', children: [{ type: 'raw', value: html }] });
    return { html, nodes: descendants(tree) };
}

test('main tabs show display aliases while preserving canonical tooltips, icons and Beta status', () => {
    const { html, nodes } = render();
    const mainTabs = nodes.filter(node => node.properties?.role === 'tab');
    assert.equal(mainTabs.length, 3);
    assert.equal(mainTabs[0].properties.ariaLabel, 'Release logs');
    assert.equal(mainTabs[0].properties.title, 'Release logs — Production server');
    assert.equal(mainTabs[1].properties.ariaLabel, 'Preview links (Beta)');
    assert.equal(mainTabs[1].properties.title, 'Preview links — Public URLs (Beta)');
    assert.match(html, /Preview links/);
    assert.match(html, />Beta<\/span>/);
    assert.equal(mainTabs.flatMap(descendants).filter(node => node.properties?.dataCanonicalIcon === 'public-urls').length, 1);
    assert.equal(tabs[0].title, 'Production server');
});

test('main-tab roving focus has one tab stop and action buttons retain native semantics', () => {
    const { nodes } = render();
    const list = nodes.find(node => node.properties?.role === 'tablist');
    assert.equal(list.properties.ariaLabel, 'Open workspaces');
    assert.equal(list.properties.ariaOrientation, 'horizontal');
    const mainTabs = nodes.filter(node => node.properties?.role === 'tab');
    assert.deepEqual(mainTabs.map(node => node.properties.tabIndex), [0, -1, -1]);
    assert.deepEqual(mainTabs.map(node => node.properties.ariaSelected), ['true', 'false', 'false']);
    const actions = nodes.filter(node => node.tagName === 'button');
    assert.ok(mainTabs.every(node => descendants(node).every(child => child.tagName !== 'button')), 'tab descendants must not contain interactive action buttons');
    const wrappers = nodes.filter(node => node.properties?.dataWorkspaceTabItem);
    assert.equal(wrappers.length, 3);
    assert.ok(wrappers.every(node => node.properties.role === 'presentation'));
    assert.ok(wrappers.every(node => descendants(node).some(child => child.properties?.role === 'tab')
        && node.children.some(child => descendants(child).some(action => action.tagName === 'button'))), 'actions and tab triggers share only a presentational wrapper');
    assert.ok(actions.every(node => node.properties.type === 'button'));
    assert.ok(actions.every(node => node.properties.ariaLabel));
    assert.ok(actions.every(node => !node.properties.ariaLabel.startsWith('Actions for ')), 'main tabs have no three-dot menu buttons');
    const backdrops = nodes.filter(node => node.properties?.dataWorkspaceTabActionFade !== undefined);
    assert.equal(backdrops.length, 3);
    assert.ok(backdrops.every(node => node.properties.className.includes('bg-linear-to-r')
        && node.properties.className.includes('from-transparent')), 'remaining actions share a theme-based gradient');
    assert.ok(backdrops.every(node => node.properties.className.includes('to-app-surface/60')), 'fades are subdued');
    assert.ok(nodes.filter(node => node.properties?.dataWorkspaceTabActions !== undefined)
        .every(node => node.properties.className.includes('motion-reduce:transition-none')));
    assert.ok(actions.every(node => node.properties.className.includes('h-6') && node.properties.className.includes('w-6')));
    assert.ok(mainTabs.every(node => !node.properties.className.includes('pr-[60px]') && !node.properties.className.includes('pr-8')),
        'hover-only controls do not reserve an empty tail');
    assert.ok(nodes.filter(node => node.properties?.dataWorkspaceTabLabel !== undefined)
        .every(node => node.properties.className.includes('group-focus-within:[mask-image:var(--zync-tab-label-mask)]')));
    const disconnect = actions.filter(node => node.properties.ariaLabel.startsWith('Disconnect '));
    assert.equal(disconnect.length, 1);
    assert.equal(disconnect[0].properties.ariaLabel, 'Disconnect Release logs');
});

test('home/no active tab remains keyboard reachable and does not expose inactive disconnect actions', () => {
    const { nodes } = render(null);
    const mainTabs = nodes.filter(node => node.properties?.role === 'tab');
    assert.deepEqual(mainTabs.map(node => node.properties.tabIndex), [0, -1, -1]);
    assert.ok(mainTabs.every(node => node.properties.ariaSelected === 'false'));
    assert.equal(nodes.filter(node => node.tagName === 'button' && node.properties?.ariaLabel?.startsWith('Disconnect ')).length, 0);
});

test('tabs without visible close or disconnect controls have no empty action backdrop', () => {
    const hiddenTabs = tabs.map(tab => ({ ...tab, presentation: { version: 2, closeButton: 'hidden' } }));
    const { nodes } = render(null, hiddenTabs);
    assert.ok(nodes.every(node => node.properties?.dataWorkspaceTabActions === undefined));
    assert.equal(nodes.filter(node => node.tagName === 'button').length, 0);
});

test('pinned compact tabs protect icons and persistent Close reserves only its own slot', () => {
    const items = tabs.map(tab => ({ ...tab, presentation: { version: 2, pinned: true, closeButton: 'always' } }));
    const { nodes } = render('host', items);
    const tabsById = nodes.filter(node => node.properties?.role === 'tab');
    assert.ok(tabsById.every(node => node.properties.className.includes('pr-8') && !node.properties.className.includes('pr-[60px]')));
    const visuals = nodes.filter(node => node.properties?.dataTabDragVisual !== undefined);
    assert.ok(visuals[0].properties.className.includes('min-w-[124px]'));
    assert.ok(visuals.slice(1).every(node => node.properties.className.includes('min-w-[100px]')));
    const fades = nodes.filter(node => node.properties?.dataWorkspaceTabActionFade !== undefined);
    assert.ok(fades.every(node => node.properties.className.includes('w-8') && node.properties.className.includes('group-focus-within:w-full')));
});

test('pinned status is non-interactive and preserves canonical identity, Beta, close and disconnect', () => {
    const pinnedTabs = tabs.map(tab => ({ ...tab, presentation: { version: 1, pinned: true } }));
    const { nodes } = render('host', pinnedTabs);
    const mainTabs = nodes.filter(node => node.properties?.role === 'tab');
    const descriptions = mainTabs.map(tab => nodes.find(node => node.properties?.id === tab.properties.ariaDescribedBy?.[0]));
    assert.ok(descriptions.every(node => node && descendants(node).some(child => child.value === 'Pinned tab')));
    assert.ok(descriptions.every(node => node.tagName === 'span' && node.properties?.role !== 'button'));
    assert.equal(mainTabs[1].properties.ariaLabel, 'Preview links (Beta)');
    assert.deepEqual(mainTabs.map(node => node.properties.dataWorkspaceTab), ['host', 'public', 'local']);
    const actions = nodes.filter(node => node.tagName === 'button');
    assert.equal(actions.filter(node => node.properties.ariaLabel.startsWith('Close ')).length, 3);
    assert.equal(actions.filter(node => node.properties.ariaLabel.startsWith('Disconnect ')).length, 1);
    assert.ok(actions.every(node => !node.properties.disabled));
    assert.ok(render().nodes.filter(node => node.properties?.role === 'tab').every(node => !node.properties.ariaDescribedBy));
});

test('menu omits Arrange and movement rows while retaining tab actions', () => {
    const items = [{ ...tabs[0], presentation: { version: 1, pinned: true } },
        { ...tabs[1], presentation: { version: 1, pinned: true } }, tabs[2]];
    for (const index of [0, 1, 2]) {
        const calls = [];
        const menu = workspaceTabContextMenu(items[index], {
            rename: () => calls.push('rename'), appearance: () => calls.push('appearance'),
            pin: value => { calls.push(value); return true; },
            close: () => calls.push('close'), disconnect: () => calls.push('disconnect'),
        });
        assert.equal(menu[1].label, index < 2 ? 'Unpin tab' : 'Pin tab');
        assert.deepEqual(menu.filter(item => !item.separator).map(item => item.label),
            ['Rename…', index < 2 ? 'Unpin tab' : 'Pin tab', 'Appearance…', 'Disconnect', 'Close tab']);
        assert.ok(menu.every(item => !item.children));
        assert.deepEqual(calls, [], 'building a menu has no side effects');
        menu[0].action(); menu[1].action(); menu[2].action(); menu[4].action(); menu[5].action();
        assert.deepEqual(calls, ['rename', index >= 2, 'appearance', 'disconnect', 'close']);
        assert.equal(menu[0].shortcut, 'F2');
    }
});

test('future tab decoration stays read-only while rename and guarded close remain available', () => {
    const menu = workspaceTabContextMenu({ ...tabs[0], presentation: { version: 99 } }, {
        rename() {}, appearance() {}, pin: () => true, close() {},
    });
    assert.equal(menu[1].disabled, true); assert.equal(menu[2].disabled, true);
    assert.equal(menu[0].disabled, undefined); assert.equal(menu.at(-1).disabled, undefined);
});

test('refused and throwing presentation actions report a stable owner error', () => {
    let errors = 0;
    const actions = {
        rename() {}, close() {}, pin: () => false,
        onError: () => errors++,
    };
    workspaceTabContextMenu(tabs[0], actions)[1].action();
    workspaceTabContextMenu(tabs[0], { ...actions, pin: () => { throw Error('private details'); } })[1].action();
    assert.equal(errors, 2);
});
