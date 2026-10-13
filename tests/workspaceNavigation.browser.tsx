import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { ActivityBar } from '../src/components/layout/navigation/ActivityBar';
import { NavigationFrame } from '../src/components/layout/navigation/NavigationFrame';
import { HostWorkspaceFrame } from '../src/components/layout/navigation/HostWorkspaceFrame';
import { WorkspaceSidebarProvider, useWorkspaceSidebar } from '../src/components/layout/navigation/WorkspaceSidebarContext';
import { SidebarChrome } from '../src/components/layout/sidebar/SidebarChrome';
import { NavigationSection } from '../src/components/settings/tabs/layout/NavigationSection';
import { CombinedTabBar } from '../src/components/layout/CombinedTabBar';
import { WorkspaceContextActions } from '../src/components/workspace/WorkspaceContextActions';
import { useAppStore } from '../src/store/useAppStore';
import { DEFAULT_WORKSPACE_NAVIGATION, changeWorkspaceNavigation, resolveWorkspaceNavigation, type NavigationChange } from '../src/features/workspace/domain/navigation';
import { createNavigationUpdater } from '../src/features/workspace/application/updateNavigation';
import { paneContentKey } from '../src/lib/paneLayout';
import '../src/index.css';
import './uiOverlays.browser.css';

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const source = '<!doctype html><html><body><label>Retained draft <input id="draft" value="original"></label></body></html>';
const connectionId = 'global-navigation-fixture';
let fail = false;
let saves = 0;
const update = createNavigationUpdater({
    read: () => ({ loading: false, generation: 0, value: useAppStore.getState().settings.workspaceNavigation }),
    save: async () => { await Promise.resolve(); if (fail) throw Error('Fixture failure'); saves++; },
    publish: (before, value) => {
        const state = useAppStore.getState();
        if (state.settings.workspaceNavigation !== before.value) return false;
        const moved = resolveWorkspaceNavigation(before.value).workspaceTabsPosition !== value.workspaceTabsPosition;
        useAppStore.setState({ settings: { ...state.settings, workspaceNavigation: value },
            ...(moved ? { globalSidebarSection: value.workspaceTabsPosition === 'default' ? 'hosts' : 'workspace' } : {}) }); return true;
    },
});
useAppStore.setState({
    settings: { ...useAppStore.getState().settings, workspaceNavigation: DEFAULT_WORKSPACE_NAVIGATION },
    tabs: [{ id: 'fixture', type: 'connection', connectionId, title: 'Fixture', view: 'terminal' }],
    activeTabId: 'fixture', activeConnectionId: connectionId, sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false,
    isLoadingSettings: false, isReloadingSettings: false, contentPresentation: {}, paneLayouts: {},
    terminals: { [connectionId]: ['Alpha', 'Beta', 'Gamma'].map(title => ({ id: title, title, type: 'local', tabVisible: true })) },
    saveSession: async () => {}, saveSessionChecked: async () => ({ ok: true }), updateWorkspaceNavigation: update,
});
const noop = () => {};

function SharedSidebar() {
    const raw = useAppStore(state => state.settings.workspaceNavigation);
    const value = resolveWorkspaceNavigation(raw);
    const section = useAppStore(state => state.globalSidebarSection);
    const sidebar = useWorkspaceSidebar();
    const [width, setWidth] = useState(260);
    const workspace = section === 'workspace' && value.workspaceTabsPosition !== 'default';
    return <SidebarChrome position={value.workspaceTabsPosition === 'right' ? 'right' : 'left'} collapsed={!workspace}
        savedWidth={width} onResize={setWidth}>
        <div ref={sidebar?.setTarget} data-workspace-sidebar-slot hidden={!workspace}
            className={workspace ? 'flex flex-col flex-1 min-h-0 pt-1.5' : ''} />
    </SidebarChrome>;
}

/** Real chrome, confirmed in-memory saves and a real iframe. Never calls native IPC or starts sessions. */
function Gallery() {
    const raw = useAppStore(state => state.settings.workspaceNavigation);
    const value = resolveWorkspaceNavigation(raw);
    const presentation = useAppStore(state => state.contentPresentation[connectionId]);
    const [selected, setSelected] = useState('Alpha');
    const [theme, setTheme] = useState('dark');
    const [result, setResult] = useState('Ready');
    const [running, setRunning] = useState(false);
    const [commands, setCommands] = useState<string[]>([]);
    const preview = useRef<HTMLDivElement>(null);
    const surface = useRef<HTMLDivElement>(null);
    const loads = useRef(0);
    useEffect(() => { document.body.dataset.overlayGalleryTheme = theme; document.body.dataset.theme = theme; }, [theme]);
    const change = async (action: NavigationChange) => { await update(action); await settle(); };
    const sort = async (selector: string, destination: string) => {
        const from = preview.current!.querySelector<HTMLElement>(selector)!;
        const to = preview.current!.querySelector<HTMLElement>(destination)!;
        const a = from.getBoundingClientRect(); const b = to.getBoundingClientRect();
        const start = { clientX: a.left + a.width / 2, clientY: a.top + a.height / 2 };
        const end = { clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 };
        const init = { pointerId: 7, isPrimary: true, button: 0, bubbles: true, cancelable: true };
        from.querySelector('[data-workspace-tab-trigger]')!.dispatchEvent(new PointerEvent('pointerdown', { ...init, ...start }));
        window.dispatchEvent(new PointerEvent('pointermove', { ...init, ...end })); await settle();
        window.dispatchEvent(new PointerEvent('pointerup', { ...init, ...end })); await settle();
    };
    const run = async () => {
        setRunning(true); setResult('Running');
        const results: string[] = [];
        const check = (condition: unknown, message: string) => { if (!condition) throw Error(message); results.push('PASS ' + message); };
        try {
            fail = false;
            useAppStore.setState({ settings: { ...useAppStore.getState().settings, workspaceNavigation: DEFAULT_WORKSPACE_NAVIGATION }, contentPresentation: {} });
            await settle();
            const frame = preview.current!.querySelector('iframe')!;
            const original = frame.contentDocument;
            const input = original?.getElementById('draft') as HTMLInputElement;
            check(input, 'Retained iframe is ready');
            input.value = 'retained text';
            const parent = frame.parentElement;
            const initialLoads = loads.current;
            await change({ type: 'visible', value: true });
            check(preview.current!.querySelector('nav[aria-label="Global navigation"]'), 'Global activity bar is opt-in');
            check(!preview.current!.querySelector('[data-navigation-item="workspace"]'), 'Undocked workspace has no duplicate navigation icon');
            for (const position of ['left', 'right'] as const) {
                await change({ type: 'position', value: position });
                const nav = preview.current!.querySelector('nav')!.getBoundingClientRect();
                const body = preview.current!.querySelector('[data-workspace-body]')!.getBoundingClientRect();
                check(position === 'left' ? nav.right <= body.left + 1 : nav.left >= body.right - 1, 'Global bar allocates ' + position);
                check(original === frame.contentDocument && frame.parentElement === parent, 'Global movement retains iframe document and parent');
            }
            for (const position of ['left', 'right', 'default'] as const) {
                await change({ type: 'workspace-tabs', value: position });
                const nav = preview.current!.querySelector('[data-workspace-tab-strip]')!.getBoundingClientRect();
                const body = preview.current!.querySelector('[data-host-workspace-body]')!.getBoundingClientRect();
                check(position === 'default' ? nav.bottom <= body.top + 1 : position === 'left' ? nav.right <= body.left + 1 : nav.left >= body.right - 1, 'Host tab bar allocates ' + position);
                check(preview.current!.querySelectorAll('[data-workspace-tab-strip]').length === 1, 'Host tab inventory renders once');
                check(position === 'default' ? !preview.current!.querySelector('[data-navigation-item="workspace"]')
                    : preview.current!.querySelector('[data-workspace-host-badge]'), 'Workspace badge is opt-in for ' + position);
                check(original === frame.contentDocument && parent === frame.parentElement && input.value === 'retained text', 'Host movement retains iframe document, parent and draft');
            }
            await change({ type: 'workspace-tabs', value: 'left' });
            await sort('[data-workspace-tab-contents]:first-child', '[data-workspace-tab-contents]:last-child');
            check(useAppStore.getState().contentPresentation[connectionId]?.order?.at(-1) === paneContentKey({ kind: 'term', termId: 'Alpha' }, 'Alpha'), 'Vertical pane drag reorders through the production adapter');
            check(selected === 'Alpha', 'Sorting does not activate another pane');
            for (const position of ['right', 'left'] as const) {
                await change({ type: 'workspace-tabs', value: position });
                const separator = preview.current!.querySelector<HTMLElement>('[role="separator"]')!;
                const width = Number(separator.getAttribute('aria-valuenow'));
                separator.dispatchEvent(new KeyboardEvent('keydown', { key: position === 'right' ? 'ArrowLeft' : 'ArrowRight', bubbles: true, cancelable: true }));
                await settle();
                check(Number(separator.getAttribute('aria-valuenow')) === width + 16, 'Shared sidebar keyboard resize expands inward on ' + position);
            }
            useAppStore.setState({ globalSidebarSection: 'hosts' }); await settle();
            check(!preview.current!.querySelector<HTMLElement>('[data-workspace-sidebar-slot]')!.getBoundingClientRect().width, 'Hosts replaces the workspace list in the same sidebar');
            useAppStore.setState({ globalSidebarSection: 'workspace' }); await settle();
            check(original === frame.contentDocument && input.value === 'retained text', 'Sidebar section changes keep the live pane');
            const moveStrip = async (edge: 'left' | 'right' | 'default') => {
                const handle = preview.current!.querySelector<HTMLElement>('[data-workspace-strip-handle]')!;
                const rect = handle.getBoundingClientRect();
                const bounds = preview.current!.querySelector<HTMLElement>('[data-navigation-frame]')!.getBoundingClientRect();
                const init = { pointerId: 17, isPrimary: true, button: 0, bubbles: true, cancelable: true };
                handle.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
                const point = { clientX: edge === 'left' ? bounds.left + 2 : edge === 'right' ? bounds.right - 2 : bounds.left + bounds.width / 2,
                    clientY: edge === 'default' ? bounds.top + 2 : bounds.top + bounds.height / 2 };
                window.dispatchEvent(new PointerEvent('pointermove', { ...init, ...point })); await settle();
                window.dispatchEvent(new PointerEvent('pointerup', { ...init, ...point })); await settle();
                check(resolveWorkspaceNavigation(useAppStore.getState().settings.workspaceNavigation).workspaceTabsPosition === edge, 'Whole-strip shared gesture docks ' + edge);
            };
            await moveStrip('right'); await moveStrip('default'); await moveStrip('left');
            await sort('[data-navigation-item="snippets"]', '[data-navigation-item="hosts"]');
            check(resolveWorkspaceNavigation(useAppStore.getState().settings.workspaceNavigation).order[0] === 'snippets', 'Global buttons use the shared pointer sorting controller');
            await change({ type: 'hidden', id: 'snippets', value: true });
            check(!preview.current!.querySelector('[data-navigation-item="snippets"]'), 'Hiding a global item removes only its button');
            await change({ type: 'hidden', id: 'snippets', value: false });
            check(preview.current!.querySelector('[data-navigation-item="snippets"]'), 'Revealing restores its saved position');
            const before = useAppStore.getState().settings.workspaceNavigation;
            fail = true;
            try { await change({ type: 'workspace-tabs', value: 'right' }); } catch { /* Expected refused save. */ }
            check(useAppStore.getState().settings.workspaceNavigation === before, 'Refused save leaves confirmed chrome unchanged');
            fail = false;
            await change({ type: 'reset' });
            check(resolveWorkspaceNavigation(useAppStore.getState().settings.workspaceNavigation).workspaceTabsPosition === 'left', 'Reset global navigation preserves host tab placement');
            await change({ type: 'visible', value: true });
            check(loads.current === initialLoads && original === frame.contentDocument, 'All chrome changes cause zero iframe reloads');
            setResult(results.join('\n') + '\nALL ' + results.length + ' CHECKS PASSED');
        } catch (error) { setResult(results.join('\n') + '\nFAIL ' + String(error)); }
        finally { fail = false; setRunning(false); }
    };
    return <TooltipProvider><main className="p-4 space-y-4 text-app-text bg-app-bg">
        <h1>Global and host navigation</h1>
        <p>Production components with in-memory preferences. No native operations. Pointer checks dispatch synthetic browser events.</p>
        <button type="button" onClick={() => { void run(); }} disabled={running}>Run navigation checks</button>{' '}
        <button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Use {theme === 'dark' ? 'light' : 'dark'} theme</button>
        <pre aria-live="polite" className="whitespace-pre-wrap text-xs max-h-40 overflow-auto">{result}</pre>
        <div ref={preview} className="flex h-96 min-w-0 border border-app-border">
            <WorkspaceSidebarProvider><NavigationFrame position={value.position} navigation={<ActivityBar preferences={value} hasWorkspace keybindings={{}}
                workspaceLabel="Fixture host" workspaceBadge={<span aria-hidden="true">H</span>}
                onCommand={id => setCommands(previous => [...previous, id])} onGlobal={id => setCommands(previous => [...previous, id])}
                onChange={change} onCustomize={() => useAppStore.getState().openSettings('layout')}
                footer={<div className="text-xs text-center p-1">Settings / Profile</div>} />}>
                <SharedSidebar />
                <WorkspaceContextActions connectionId={connectionId} tabId="fixture" active openRequest={0}
                    onSetHidden={(id, hidden) => useAppStore.getState().setContentHidden(connectionId, id, hidden)}
                    onSelectContent={() => true} onRevealAll={() => useAppStore.getState().revealAllContent(connectionId)}>
                    <HostWorkspaceFrame navigation={<CombinedTabBar connectionId={connectionId} tabId="fixture" activeView="terminal" activeTerminalId={selected}
                        featureTabs={[]} activeFeatureTabId={null} pinnedFeatures={[]} onTabSelect={(_view, id) => setSelected(id ?? selected)}
                        onPluginTabSelect={noop} onPluginTabClose={noop} onFeatureTabSelect={noop} onFeatureTabClose={noop}
                        onTerminalClose={noop} onNewTerminal={noop} onTogglePin={noop} availableShells={[{ id: 'bash', label: 'Bash' }]}
                        dockPointer={{ contextId: 'fixture', isEnabled: () => true, getSurface: () => surface.current,
                            onDragStart: noop, onDragEnd: noop, onDragCancel: noop }} />}>
                        <div ref={surface} className="flex-1 min-w-0 bg-app-surface p-2">
                            <iframe title="Retained preview" srcDoc={source} onLoad={() => { loads.current++; }} className="w-full h-32" />
                            <output data-commands>{commands.join(',')}</output>
                        </div>
                    </HostWorkspaceFrame>
                </WorkspaceContextActions>
            </NavigationFrame></WorkspaceSidebarProvider>
        </div>
        <pre aria-label="Navigation fixture state" className="whitespace-pre-wrap text-xs">{JSON.stringify({ preferences: value, paneOrder: presentation?.order, saves }, null, 2)}</pre>
        <div className="max-w-xl"><NavigationSection value={raw} onChange={change} /></div>
    </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Gallery />);
