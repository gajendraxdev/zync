import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { CombinedTabBar } from '../src/components/layout/CombinedTabBar';
import { PaneHeader } from '../src/components/workspace/PaneHeader';
import { WorkspaceContextActions } from '../src/components/workspace/WorkspaceContextActions';
import { useWorkspaceContextActions } from '../src/components/workspace/workspaceActionsContext';
import type { DockedPaneRegion } from '../src/features/workspace/domain/docking';
import { PaneSurfaceLayer } from '../src/components/workspace/PaneSurfaceLayer';
import { WorkspaceDockingFrame } from '../src/components/workspace/WorkspaceDockingFrame';
import { workspaceDockingSurfaces } from '../src/components/workspace/workspaceDockingSurfaces';
import { usePaneSurfaceGeometry } from '../src/components/workspace/usePaneSurfaceGeometry';
import { workspaceDockingView } from '../src/features/workspace/domain/dockingView';
import { selectExistingWorkspaceContent } from '../src/features/workspace/application/selectExistingContent';
import { useDockTabPointer, type DockTabPointerHandlers } from '../src/components/layout/tabDock';
import { useAppStore } from '../src/store/useAppStore';
import { collectLeaves, paneContentKey, paneDockPayload, type PaneLeaf, type PaneLayout, type PaneNode } from '../src/lib/paneLayout';
import { workspaceCanvases } from '../src/features/workspace/domain/canvases';
import { paneTabReleaseSource, planPaneTabInsertion } from '../src/features/workspace/domain/paneTabRelease';
import { buildWorkspaceViewRegistrations } from '../src/features/workspace/application/viewRegistrationAdapters';
import { DEFAULT_WORKSPACE_NAVIGATION, resolveWorkspaceNavigation } from '../src/features/workspace/domain/navigation';
import { dragTab } from './helpers/tabDrag.browser';
import '../src/index.css';
import './uiOverlays.browser.css';

// Isolated in-memory fixture: production chrome, gesture and unsplit action; no native resources.
const scope = 'pane-tab-release-fixture';
const files: PaneLeaf = { type: 'pane', id: 'files-pane', content: { kind: 'feature', featureId: 'files', instanceId: 'files-one' } };
const plugin: PaneLeaf = { type: 'pane', id: 'plugin-pane', content: { kind: 'plugin', pluginId: 'fixture:panel', instanceId: 'plugin-one' } };
const key = (pane: PaneLeaf) => paneContentKey(pane.content, pane.id);
const joined: PaneLayout = { version: 1, activePaneId: files.id, root: { type: 'split', id: 'fixture-split', direction: 'horizontal', sizes: [0.5, 0.5], children: [files, plugin] } };
const root = createRoot(document.querySelector('#root')!);
const results = document.querySelector<HTMLPreElement>('#results')!;
const mounts = new Map<string, number>();
const noop = () => {};
useAppStore.setState({ tabs: [{ id: 'fixture', type: 'connection', connectionId: scope, title: 'Fixture', view: 'files' }], activeTabId: 'fixture',
    sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false,
    isLoadingSettings: false, isReloadingSettings: false,
    workspaceViewRegistry: buildWorkspaceViewRegistrations([{ id: 'fixture:panel', pluginId: 'fixture', title: 'Plugin', allowMultiple: true }]),
    saveSession: async () => {}, saveSessionChecked: async () => ({ ok: true }),
});
const get = () => useAppStore.getState();
const select = (id: string) => selectExistingWorkspaceContent(get(), scope, id, noop, view => get().setTabView('fixture', view));
const canvases = () => workspaceCanvases(get().terminals[scope] ?? [], get().paneLayouts[scope]);
const handlers: DockTabPointerHandlers = {
    contextId: 'fixture', isEnabled: () => get().activeTabId === 'fixture',
    getSurface: () => document.querySelector('#probe-surface'),
    getTabStrip: () => document.querySelector('[data-tab-drag-strip]'),
    getPaneTabSource: payload => {
        const source = paneTabReleaseSource(canvases(), payload, get().contentPresentation[scope]);
        return source && source.memberIds.length > 1 ? source : null;
    },
    canDropPaneTab: insertion => planPaneTabInsertion(get().terminals[scope] ?? [], get().paneLayouts[scope], get().contentPresentation[scope], insertion) !== null,
    onPaneTabDrop: insertion => get().releasePaneFromSplit(scope, { contentId: insertion.source.contentId }, insertion),
    onDragStart: noop, onDragCancel: noop, onDragEnd: noop,
};
function Probe({ pane, title, dockRegion, focused, showHeader }: { pane: PaneLeaf; title: string; dockRegion?: DockedPaneRegion; focused?: boolean; showHeader: boolean }) {
    const { begin } = useDockTabPointer(handlers);
    const actions = useWorkspaceContextActions();
    useEffect(() => { mounts.set(key(pane), (mounts.get(key(pane)) ?? 0) + 1); }, [pane]);
    return <section className="min-w-0 h-full flex flex-col border border-app-border" data-probe={pane.id}>
        {showHeader && <PaneHeader label={title} defaultTitle={title} icon={<span>▣</span>} onPointerDown={event => begin(event, paneDockPayload(pane))} onClose={noop} onRename={noop}
            dockRegion={dockRegion} dockFocused={focused} onOpenContextMenu={event => actions?.open(event, [key(pane)])}
            onReturnToTabs={() => actions?.returnToTabs?.(key(pane))} returnToTabsDisabled={!actions?.canReturnToTabs?.(key(pane))} />}
        <iframe title={`${title} state probe`} className="w-full h-32" srcDoc='<input aria-label="Retained value" value="initial" />' />
    </section>;
}

/** Disposable allocation slots; resource probes stay in the retained production layer. */
function Slots({ node, register }: { node: PaneNode; register: (id: string, element: HTMLDivElement | null) => void }) {
    if (node.type === 'pane') return <div className="h-full w-full" ref={element => register(key(node), element)} />;
    return <div className={`flex h-full w-full ${node.direction === 'vertical' ? 'flex-col' : ''}`}>
        {node.children.map((child, index) => <div key={child.id} className="min-w-0 min-h-0" style={{ flex: node.sizes[index] }}>
            <Slots node={child} register={register} /></div>)}
    </div>;
}
function Gallery() {
    const state = useAppStore();
    const groups = state.paneLayouts[scope];
    const container = useRef<HTMLDivElement>(null);
    const { registerSlot, registerHost } = usePaneSurfaceGeometry(container);
    const view = workspaceDockingView(state, scope);
    if (!view.projection.ok) throw Error('Fixture allocation is invalid');
    const projection = view.projection.value;
    const vertical = useAppStore(state => resolveWorkspaceNavigation(state.settings.workspaceNavigation).workspaceTabsPosition !== 'default');
    return <TooltipProvider><WorkspaceContextActions connectionId={scope} tabId="fixture" active openRequest={0}
        onSelectContent={select} onSetHidden={(id, hidden) => get().setContentHidden(scope, id, hidden)} onRevealAll={() => get().revealAllContent(scope)}>
        <main className="p-6 bg-app-bg text-app-text min-h-screen">
        <h1 className="text-lg mb-2">Drag a pane header back to its tab strip</h1>
        <p className="mb-4">Production gesture and unsplit action. The frames below are retained state probes, not real sessions.</p>
        <div style={{ height: vertical ? 220 : 36, width: vertical ? 220 : undefined }}><CombinedTabBar connectionId={scope} tabId="fixture" activeView={state.tabs[0].view} activeTerminalId={state.activeTerminalIds[scope]}
            featureTabs={[{ id: 'files-one', featureId: 'files', instanceId: 'files-one' }]} activeFeatureTabId="files-one" pinnedFeatures={[]}
            pluginPanels={[{ id: 'fixture:panel', title: 'Plugin', allowMultiple: true }]}
            onTabSelect={(_view, termId) => { if (termId) get().setActiveTerminal(scope, termId); }} onPluginTabSelect={id => { select(id); }} onPluginTabClose={noop}
            onFeatureTabSelect={id => { select(paneContentKey({ kind: 'feature', featureId: 'files', instanceId: id }, id)); }} onFeatureTabClose={noop}
            onTerminalClose={noop} onNewTerminal={noop} onTogglePin={noop} onPaneGroupClose={noop} dockPointer={handlers} /></div>
        <div id="probe-surface" ref={container} className="relative mt-3 h-64">
            <WorkspaceDockingFrame projection={projection} renderAllocation={allocation => <Slots node={allocation.layout.root} register={registerSlot} />}
                emptyWorkspace={<p>No center allocation</p>} />
            <PaneSurfaceLayer surfaces={workspaceDockingSurfaces(view.canvases, projection, true)} registerHost={registerHost}
                renderSurface={surface => {
                    const content = surface.node.content;
                    const title = content.kind === 'term'
                        ? state.terminals[scope]?.find(term => term.id === content.termId)?.title ?? 'Shell'
                        : content.kind === 'plugin' ? 'Plugin' : 'Files';
                    const dockRegion = view.preferences?.placements[surface.key];
                    return <Probe pane={surface.node} title={title} dockRegion={dockRegion} focused={surface.focused} showHeader={surface.split || !!dockRegion} />;
                }} />
        </div>
        <p className="mt-4">{Object.values(groups ?? {}).some(layout => collectLeaves(layout.root).length > 1) ? 'Grouped: Files + Plugin' : 'Separate tabs: Files and Plugin'}</p>
    </main></WorkspaceContextActions></TooltipProvider>;
}
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function reset(vertical = false) {
    flushSync(() => useAppStore.setState({ terminals: { [scope]: [{ id: 'neighbor', title: 'Shell neighbor', tabVisible: true }] },
        paneLayouts: { [scope]: { 'files-one': joined } }, activePaneGroupOwner: { [scope]: 'files-one' },
        workspaceDocking: {}, contentPresentation: {}, settings: { ...get().settings,
            workspaceNavigation: { ...DEFAULT_WORKSPACE_NAVIGATION, workspaceTabsPosition: vertical ? 'left' : 'default' } } }));
}
function check(condition: unknown, message: string) {
    if (!condition) throw Error(message);
    results.textContent += `\nPASS ${message}`;
}
const header = () => document.querySelector<HTMLElement>('[data-probe="plugin-pane"] [data-tab-drag-source]')!;
const slot = () => [...document.querySelectorAll<HTMLElement>('[data-workspace-tab-contents]')].find(element => element.getAttribute('data-workspace-tab-contents')?.includes('neighbor'))!;
document.body.dataset.overlayGalleryTheme = 'dark';
reset(); root.render(<Gallery />);
document.querySelector<HTMLButtonElement>('#example')!.onclick = () => {
    flushSync(() => useAppStore.setState({ terminals: { [scope]: [{ id: 'neighbor', title: 'Shell 2', tabVisible: true }, { id: 'dock-shell', title: 'Shell 1', tabVisible: true }] },
        paneLayouts: { [scope]: { 'files-one': { version: 1, root: files, activePaneId: files.id }, 'plugin-one': { version: 1, root: plugin, activePaneId: plugin.id } } },
        activeTerminalIds: { [scope]: 'neighbor' }, activePaneGroupOwner: { [scope]: null }, workspaceDockFocus: { [scope]: '["term","dock-shell"]' },
        contentPresentation: {}, workspaceDocking: { [scope]: { version: 1, placements: { '["term","dock-shell"]': 'secondary-sidebar', [key(files)]: 'primary-sidebar', [key(plugin)]: 'bottom-panel' } } },
        tabs: [{ id: 'fixture', type: 'connection', connectionId: scope, title: 'Fixture', view: 'terminal' }],
        settings: { ...get().settings, workspaceNavigation: { ...DEFAULT_WORKSPACE_NAVIGATION, workspaceTabsPosition: 'default' } } }));
};
document.querySelector<HTMLButtonElement>('#theme')!.onclick = () => {
    document.body.dataset.overlayGalleryTheme = document.body.dataset.overlayGalleryTheme === 'light' ? 'dark' : 'light';
};
document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
    const button = document.querySelector<HTMLButtonElement>('#run')!;
    button.disabled = true; results.textContent = 'Running';
    try {
        await settle();
        const frame = document.querySelector<HTMLIFrameElement>('[data-probe="plugin-pane"] iframe')!;
        if (!frame.contentDocument?.querySelector('input')) await new Promise<void>(resolve => frame.addEventListener('load', () => resolve(), { once: true }));
        const input = frame.contentDocument!.querySelector('input')!;
        input.value = 'kept across unsplit';
        const initialMounts = mounts.get(key(plugin));
        for (const vertical of [false, true]) {
            reset(vertical); await settle();
            const before = get().paneLayouts;
            await dragTab(header(), slot(), { cancel: true, during: () => check(document.querySelector('[data-pane-tab-insertion]') instanceof HTMLElement,
                `${vertical ? 'Vertical' : 'Horizontal'} strip offers insertion feedback`) });
            check(get().paneLayouts === before && !document.querySelector('[data-pane-tab-insertion]'), 'Escape keeps the group and cleans insertion feedback');
            await dragTab(header(), slot(), { after: false });
            check(Object.values(get().paneLayouts[scope]!).every(layout => collectLeaves(layout.root).length === 1), 'Only the dragged plugin becomes a separate tab');
            const order = get().contentPresentation[scope].order!;
            check(order.indexOf(key(plugin)) < order.indexOf('["term","neighbor"]'), 'Released pane lands before the chosen tab');
            check(document.querySelector('[data-probe="plugin-pane"] iframe') === frame && frame.contentDocument!.querySelector('input') === input
                && input.value === 'kept across unsplit' && mounts.get(key(plugin)) === initialMounts, 'Retained iframe document and input state survive');
            reset(vertical); await settle();
            const openTab = document.querySelector<HTMLButtonElement>('button[aria-label="Open a tab"]')!;
            await dragTab(header(), openTab, { during: () => check(document.querySelector<HTMLElement>('[data-pane-tab-insertion]')?.hidden === false,
                `${vertical ? 'Vertical' : 'Horizontal'} open-tab area offers insertion feedback`) });
            check(get().contentPresentation[scope]?.order?.at(-1) === key(plugin), 'Dropping over + appends the released pane');
            check(openTab.getAttribute('aria-expanded') === 'false', 'Dropping does not open the + menu');
            if (!vertical) {
                reset(); await settle();
                const trailing = document.querySelector<HTMLElement>('[data-tab-insertion-surface]')!;
                await dragTab(header(), trailing);
                check(get().contentPresentation[scope]?.order?.at(-1) === key(plugin), 'Empty space beside + accepts the pane as the last tab');
            }
        }
        reset(); await settle();
        const own = [...document.querySelectorAll<HTMLElement>('[data-workspace-tab-contents]')].find(element => element.getAttribute('data-workspace-tab-contents')?.includes('plugin-one'))!;
        await dragTab(header(), own, { after: true });
        check(get().contentPresentation[scope].order!.indexOf(key(plugin)) > get().contentPresentation[scope].order!.indexOf(key(files)), 'Own-group drop inserts after its remaining pane');
        check(get().contentPresentation[scope].order![0] === '["term","neighbor"]', 'Own-group drop preserves unrelated tab position without saved ranks');
        check(!document.querySelector('[data-pane-tab-insertion]'), 'Drop cleans insertion feedback');
        flushSync(() => useAppStore.setState({ terminals: { [scope]: [{ id: 'neighbor', title: 'Shell 2', tabVisible: true }, { id: 'dock-shell', title: 'Shell 1', tabVisible: true }] },
            paneLayouts: { [scope]: { 'plugin-one': { version: 1, root: plugin, activePaneId: plugin.id } } },
            activeTerminalIds: { [scope]: 'neighbor' }, activePaneGroupOwner: { [scope]: null }, contentPresentation: {}, workspaceDockFocus: {},
            workspaceDocking: { [scope]: { version: 1, placements: { '["term","dock-shell"]': 'secondary-sidebar', [key(plugin)]: 'bottom-panel' } } },
            tabs: [{ id: 'fixture', type: 'connection', connectionId: scope, title: 'Fixture', view: 'terminal' }] }));
        await settle();
        const center = document.querySelector<HTMLElement>('[data-region-owner="neighbor"]')!;
        const clickTab = async (id: string) => {
            const target = [...document.querySelectorAll<HTMLElement>('[data-workspace-tab-contents]')]
                .find(element => JSON.parse(element.getAttribute('data-workspace-tab-contents')!).includes(id))!;
            target.querySelector<HTMLButtonElement>('[data-workspace-tab-trigger]')!.click(); await settle();
        };
        await clickTab('["term","dock-shell"]');
        check(get().activeTerminalIds[scope] === 'neighbor' && get().workspaceDockFocus[scope] === '["term","dock-shell"]'
            && center.isConnected && center.getBoundingClientRect().width > 0, 'Clicking docked Shell 1 keeps Shell 2 in the center');
        const dockState = get(); await clickTab('["term","dock-shell"]');
        check(get() === dockState, 'Repeated docked-shell tab clicks do not churn selection');
        await clickTab(key(plugin));
        check(get().activeTerminalIds[scope] === 'neighbor' && get().workspaceDockFocus[scope] === key(plugin)
            && center.isConnected && frame.contentDocument!.querySelector('input') === input && input.value === 'kept across unsplit',
            'Plugin dock tab keeps center selection and its retained iframe draft');
        await clickTab('["term","neighbor"]');
        check(!get().workspaceDockFocus[scope] && center.isConnected, 'Selecting the center tab restores center input ownership');
        flushSync(() => useAppStore.setState({ paneLayouts: { [scope]: { ...get().paneLayouts[scope], 'files-one': { version: 1, root: files, activePaneId: files.id } } },
            workspaceDocking: { [scope]: { ...get().workspaceDocking[scope], placements: { ...get().workspaceDocking[scope].placements, [key(files)]: 'primary-sidebar' } } } }));
        await settle();
        const tabFor = (id: string) => [...document.querySelectorAll<HTMLElement>('[data-workspace-tab-contents]')]
            .find(element => JSON.parse(element.dataset.workspaceTabContents!).includes(id))!;
        check(document.querySelectorAll('[data-workspace-tab-strip] [data-dock-indicator]').length === 3,
            'Shell, Files and plugin tabs share one dock indicator each');
        await clickTab('["term","dock-shell"]');
        check(tabFor('["term","dock-shell"]').querySelector('[data-dock-focused="true"]')
            && document.querySelector('[data-probe="dock-shell"] [data-pane-dock][data-dock-focused="true"]'),
            'Dock input focus marks its tab icon and contained pane header');
        check(tabFor('["term","neighbor"]').querySelector('[aria-pressed="true"]') && center.isConnected,
            'Dock focus does not replace selected center-tab feedback');
        for (const [id, paneId, title, expectedView] of [
            ['["term","dock-shell"]', 'dock-shell', 'Shell 1', 'terminal'],
            [key(plugin), plugin.id, 'Plugin', 'plugin:fixture:panel'], [key(files), files.id, 'Files', 'files'],
        ]) {
            const probe = document.querySelector<HTMLElement>(`[data-probe="${paneId}"]`)!;
            const retained = probe.querySelector('iframe')!;
            const draft = retained.contentDocument!.querySelector('input')!;
            draft.value = `kept ${title}`;
            const control = probe.querySelector<HTMLButtonElement>(`button[aria-label="Return ${title} to tabs"]`)!;
            control.focus(); await settle();
            if (title === 'Shell 1') check([...document.querySelectorAll('[role="tooltip"]')].some(tooltip => tooltip.textContent?.includes('Return to tabs')),
                'Keyboard focus exposes the Zync Return to tabs tooltip');
            check(control.getAttribute('title') === null && !control.disabled, `${title}: return is a named, enabled button without a native tooltip`);
            if (title === 'Files') {
                const paneHeader = probe.querySelector<HTMLElement>('[data-pane-dock]')!;
                paneHeader.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 300 })); await settle();
                const menuAction = [...document.querySelectorAll<HTMLButtonElement>('.context-menu-container button')].find(button => button.textContent?.trim() === 'Return to tabs')!;
                check(!!menuAction, 'Files: header context menu exposes the same Return to tabs action');
                menuAction.click();
            } else control.click();
            await settle();
            check(!get().workspaceDocking[scope]?.placements[id] && !tabFor(id).querySelector('[data-dock-indicator]')
                && get().tabs[0].view === expectedView, `${title}: return removes only its dock marker and selects the existing center tab`);
            check(!probe.querySelector(`button[aria-label="Return ${title} to tabs"]`) && document.activeElement === tabFor(id).querySelector('[data-workspace-tab-trigger]'),
                `${title}: removed return action or menu restores keyboard focus to its exact tab`);
            if (title === 'Files') check(!probe.querySelector('[data-tab-drag-source]'),
                'Files: final context-menu return removes its standalone header before focus recovery');
            check(probe.querySelector('iframe') === retained && retained.contentDocument!.querySelector('input') === draft && draft.value === `kept ${title}`,
                `${title}: return preserves the same browsing context and draft`);
        }
        check(document.querySelectorAll('[data-workspace-tab-strip] [data-dock-indicator]').length === 0,
            'Returning all docks leaves normal tabs without stale indicators');
        results.textContent += '\nALL CHECKS PASSED';
    } catch (error) { results.textContent += `\nFAIL ${error instanceof Error ? error.stack : String(error)}`; }
    finally { button.disabled = false; results.scrollTop = results.scrollHeight; }
};
import.meta.hot?.dispose(() => root.unmount());
