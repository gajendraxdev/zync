import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { CombinedTabBar } from '../src/components/layout/CombinedTabBar';
import { WorkspaceContextActions } from '../src/components/workspace/WorkspaceContextActions';
import { useAppStore } from '../src/store/useAppStore';
import { paneContentKey } from '../src/lib/paneLayout';
import { buildWorkspaceViewRegistrations } from '../src/features/workspace/application/viewRegistrationAdapters';
import '../src/index.css';
import './uiOverlays.browser.css';

// Isolated fixture document. No IPC, connections, plugin execution or persistence.
const connectionId = 'context-actions-fixture';
let saves = 0;
useAppStore.setState({
    tabs: [{ id: 'fixture', type: 'connection', connectionId, title: 'Fixture host', view: 'terminal' }],
    activeTabId: 'fixture', sessionLoaded: true, isRestoring: false, sessionPersistenceBlocked: false,
    isLoadingSettings: false, isReloadingSettings: false,
    workspaceViewRegistry: buildWorkspaceViewRegistrations([]),
    terminals: { [connectionId]: ['Alpha', 'Beta', 'Gamma'].map(title => ({ id: title, title, tabVisible: true })) },
    paneLayouts: {}, contentPresentation: {},
    saveSession: async () => { saves++; },
    saveSessionChecked: async () => { saves++; return { ok: true }; },
});
const key = (id: string) => paneContentKey({ kind: 'term', termId: id }, id);
const noop = () => {};

function Gallery() {
    const [selected, setSelected] = useState('Alpha');
    const [openRequest, setOpenRequest] = useState(0);
    const surface = useRef<HTMLDivElement>(null);
    const presentation = useAppStore(state => state.contentPresentation[connectionId]);
    const select = (id: string) => {
        const terminal = useAppStore.getState().terminals[connectionId]?.find(terminal => key(terminal.id) === id);
        if (!terminal) return false;
        setSelected(terminal.id);
        return true;
    };
    return <TooltipProvider><main className="p-6 text-app-text bg-app-bg min-h-screen">
        <h1 className="text-lg mb-3">Contextual pane actions</h1>
        <p className="mb-4">Drag tabs to reorder. Right-click for Rename, Pin and Hide. Keyboard: Tab, Shift+F10, F2.</p>
        <WorkspaceContextActions connectionId={connectionId} tabId="fixture" active openRequest={openRequest}
            onSetHidden={(id, hidden) => useAppStore.getState().setContentHidden(connectionId, id, hidden)}
            onSelectContent={select} onRevealAll={() => useAppStore.getState().revealAllContent(connectionId)}>
            <CombinedTabBar connectionId={connectionId} tabId="fixture" activeView="terminal" activeTerminalId={selected}
                featureTabs={[]} activeFeatureTabId={null} pinnedFeatures={[]}
                onTabSelect={(_view, id) => setSelected(id ?? selected)} onPluginTabSelect={noop} onPluginTabClose={noop}
                onFeatureTabSelect={noop} onFeatureTabClose={noop} onTerminalClose={noop} onNewTerminal={noop} onTogglePin={noop}
                dockPointer={{ contextId: 'fixture', isEnabled: () => true, getSurface: () => surface.current,
                    onDragStart: noop, onDragEnd: noop, onDragCancel: noop }} />
            <div ref={surface} className="p-4 h-32 border border-app-border">Retained content placeholder — no sessions started.</div>
        </WorkspaceContextActions>
        <button className="mt-4 p-2 border border-app-border rounded" onClick={() => setOpenRequest(value => value + 1)}>Show hidden panes command</button>
        <button className="ml-2 p-2 border border-app-border rounded" onClick={() => {
            document.body.dataset.overlayGalleryTheme = document.body.dataset.overlayGalleryTheme === 'dark' ? 'light' : 'dark';
        }}>Toggle theme</button>
        <button className="ml-2 p-2 border border-app-border rounded" onClick={() => {
            // Simulate a destination with fewer/differently identified resources, without IPC.
            useAppStore.setState({ terminals: { [connectionId]: [{ id: 'destination', title: 'Destination shell', tabVisible: true }] },
                paneLayouts: {}, contentPresentation: {}, workspaceDocking: {} });
            setSelected('destination');
        }}>Use one-pane destination fixture</button>
        <pre className="mt-4" aria-label="Fixture state">{JSON.stringify({ order: presentation?.order, items: presentation?.items, saves }, null, 2)}</pre>
        <p>Canonical IDs: {['Alpha', 'Beta', 'Gamma'].map(key).join(' · ')}</p>
    </main></TooltipProvider>;
}
document.body.dataset.overlayGalleryTheme = 'dark';
const root = createRoot(document.querySelector('#root')!);
root.render(<Gallery />);
let runId = 0;
const runFocus = document.querySelector<HTMLButtonElement>('#run-focus')!;
const focusResults = document.querySelector<HTMLElement>('#focus-results')!;
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const paneTrigger = (title: string) => [...document.querySelectorAll<HTMLButtonElement>('[data-workspace-tab-contents] [data-workspace-tab-trigger]')]
    .find(button => button.getAttribute('aria-label') === `${title} tab`)!;
const menuItem = (title: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find(button => button.textContent?.trim() === title)!;
const check = (value: unknown, label: string) => {
    if (!value) throw Error(label);
    focusResults.textContent += `\nPASS ${label}`;
};
const openKeyboardMenu = async (trigger: HTMLElement) => {
    trigger.focus();
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true }));
    await settle();
};
runFocus.onclick = async () => {
    runFocus.disabled = true;
    focusResults.textContent = 'Running';
    try {
        // Reset disposable in-memory records only, never live application sessions.
        useAppStore.setState({ terminals: { [connectionId]: ['Alpha', 'Beta', 'Gamma'].map(title => ({ id: title, title, tabVisible: true })) },
            paneLayouts: {}, contentPresentation: {}, workspaceDocking: {}, activeTabId: 'fixture' });
        saves = 0;
        flushSync(() => root.render(<Gallery key={++runId} />));
        await settle();
        await openKeyboardMenu(paneTrigger('Beta'));
        check(!menuItem('Arrange') && !menuItem('Move earlier') && !menuItem('Move later') && !menuItem('Move to'),
            'Pane menu omits redundant arrangement and move options');
        check(document.activeElement === menuItem('Rename…'), 'Keyboard menu focuses an enabled action');
        menuItem('Hide').click(); await settle();
        check(!paneTrigger('Beta') && document.activeElement === paneTrigger('Alpha'),
            'Hiding a pane tab focuses a surviving selection button, not its wrapper');
        check(paneTrigger('Alpha').getAttribute('aria-pressed') === 'true'
            && useAppStore.getState().terminals[connectionId].length === 3,
            'Focus recovery neither activates another pane nor disposes hidden content');
        await openKeyboardMenu(paneTrigger('Alpha'));
        menuItem('Hide').click(); await settle();
        check(document.activeElement === paneTrigger('Gamma'), 'Recovery skips tabs already hidden');
        await openKeyboardMenu(paneTrigger('Gamma'));
        menuItem('Hide').click(); await settle();
        const strip = document.querySelector<HTMLElement>('[data-workspace-tab-strip]')!;
        check(!document.querySelector('[data-workspace-tab-contents]') && document.activeElement === strip,
            'Hiding the final pane focuses the keyboard-reachable empty strip');
        const recoveryOpener = strip.querySelector<HTMLElement>('[data-workspace-tab-trigger]') ?? strip;
        await openKeyboardMenu(strip);
        menuItem('Show all panes').click(); await settle();
        check(paneTrigger('Beta') && document.activeElement === recoveryOpener, 'Empty-strip recovery remains available and preserves its opener');
        const beta = paneTrigger('Beta');
        await openKeyboardMenu(beta);
        menuItem('Rename…').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        await settle();
        check(document.activeElement === beta, 'Ordinary cancellation still restores the exact surviving tab');
        await openKeyboardMenu(beta);
        const outside = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Toggle theme')!;
        outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); outside.focus(); await settle();
        check(document.activeElement === outside, 'Menu dismissal does not steal focus from an outside control');
        focusResults.textContent += '\nALL CHECKS PASSED';
    } catch (error) { focusResults.textContent += `\nFAIL ${error instanceof Error ? error.stack : String(error)}`; }
    finally { runFocus.disabled = false; }
};
import.meta.hot?.dispose(() => root.unmount());
