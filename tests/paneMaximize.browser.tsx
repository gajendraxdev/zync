import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { PaneHeader } from '../src/components/workspace/PaneHeader';
import { PaneSurfaceLayer } from '../src/components/workspace/PaneSurfaceLayer';
import { WorkspaceDockingFrame } from '../src/components/workspace/WorkspaceDockingFrame';
import { workspaceDockingSurfaces } from '../src/components/workspace/workspaceDockingSurfaces';
import { usePaneSurfaceGeometry } from '../src/components/workspace/usePaneSurfaceGeometry';
import { projectWorkspaceDocking, projectMaximizedWorkspacePane } from '../src/features/workspace/domain/dockingProjection';
import { paneContentKey } from '../src/lib/paneLayout/contentIdentity';
import type { PaneNode } from '../src/lib/paneLayout/types';
import type { WorkspaceCanvas } from '../src/features/workspace/domain/canvases';
import { Button } from '../src/components/ui/Button';
import '../src/index.css';
import './uiOverlays.browser.css';

const shell = { type: 'pane', id: 'shell', content: { kind: 'term', termId: 'shell' } } as const;
const plugin = { type: 'pane', id: 'plugin', content: { kind: 'plugin', pluginId: 'probe', instanceId: 'probe' } } as const;
const canvases: WorkspaceCanvas[] = [{ owner: 'main', layout: { version: 1, activePaneId: 'plugin',
    root: { type: 'split', id: 'split', direction: 'horizontal', sizes: [0.4, 0.6], children: [shell, plugin] } } }];
const pluginKey = paneContentKey(plugin.content, plugin.id);
const placements = new Map([[pluginKey, 'bottom-panel' as const]]);
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Disposable geometry only; live DOM remains in the production retained layer. */
function Slots({ node, register }: { node: PaneNode; register: (id: string, node: HTMLDivElement | null) => void }) {
    if (node.type === 'pane') return <div className="h-full w-full" ref={element => register(paneContentKey(node.content, node.id), element)} />;
    return <div className="flex h-full w-full">{node.children.map((child, index) => <div key={child.id} style={{ flex: node.sizes[index] }}>
        <Slots node={child} register={register} /></div>)}</div>;
}

function Gallery() {
    const [maximized, setMaximized] = useState(false);
    const [hidden, setHidden] = useState(false);
    const [light, setLight] = useState(false);
    const [narrow, setNarrow] = useState(false);
    const [result, setResult] = useState('Ready');
    const [running, setRunning] = useState(false);
    const container = useRef<HTMLDivElement>(null);
    const loads = useRef(0);
    const { registerSlot, registerHost } = usePaneSurfaceGeometry(container);
    const base = projectWorkspaceDocking(canvases, placements, hidden ? new Set([pluginKey]) : new Set(), 'main', pluginKey);
    if (!base.ok) throw Error('Invalid fixture');
    const projection = projectMaximizedWorkspacePane(base.value, maximized ? { contentId: pluginKey, selectedOwner: 'main' } : undefined, 'main');
    useEffect(() => { document.body.dataset.overlayGalleryTheme = light ? 'light' : 'dark'; }, [light]);
    useEffect(() => { if (maximized && !projection.maximizedContentId) setMaximized(false); }, [maximized, projection.maximizedContentId]);
    const run = async () => {
        setRunning(true); setResult('Running'); const checks: string[] = [];
        const check = (valid: unknown, message: string) => { if (!valid) throw Error(message); checks.push(`PASS ${message}`); };
        const change = async (action: () => void) => { flushSync(action); await settle(); };
        try {
            await change(() => { setMaximized(false); setHidden(false); });
            const frame = container.current!.querySelector<HTMLIFrameElement>('iframe')!;
            const doc = frame.contentDocument!;
            const draft = doc?.getElementById('draft') as HTMLInputElement | null;
            if (!draft) throw Error('Wait for the isolated plugin probe to load, then retry.');
            draft.value = 'Preserved plugin draft';
            const host = frame.closest<HTMLElement>('[data-pane-surface]')!;
            const parent = host.parentElement;
            const originalBox = host.getBoundingClientRect(); const originalLoads = loads.current;
            const button = host.querySelector<HTMLButtonElement>('[aria-label="Maximize Plugin pane"]')!;
            button.focus();
            await change(() => button.click());
            const box = container.current!.getBoundingClientRect(); const expanded = host.getBoundingClientRect();
            check(Math.abs(expanded.width - box.width) < 1 && Math.abs(expanded.height - box.height) < 1, 'Maximized pane fills the workspace allocation');
            check(container.current!.querySelectorAll('[data-pane-surface]').length === 2, 'Sibling resources remain mounted');
            check(container.current!.querySelector('[data-pane-surface][inert][aria-hidden="true"]'), 'Non-maximized sibling is inert and hidden');
            check(document.activeElement === button && button.getAttribute('aria-label') === 'Restore Plugin pane', 'Focused action remains a reachable restore button');
            check(frame.contentDocument === doc && host.parentElement === parent && draft.value === 'Preserved plugin draft', 'Iframe document, host parent and draft survive maximize');
            check(!container.current!.querySelector('[role="separator"]'), 'Hidden regions leave no resize controls');
            await change(() => button.click());
            const restored = host.getBoundingClientRect();
            check(Math.abs(restored.top - originalBox.top) < 1 && Math.abs(restored.height - originalBox.height) < 1, 'Restore returns to the same saved dock geometry');
            check(!container.current!.querySelector('[data-pane-surface][inert]'), 'Restored siblings regain accessibility');
            for (let index = 0; index < 4; index++) await change(() => button.click());
            check(frame.contentDocument === doc && loads.current === originalLoads && host.parentElement === parent, 'Repeated toggles never reload or reparent the iframe');
            await change(() => setMaximized(true));
            await change(() => setHidden(true));
            check(host.inert && host.getAttribute('aria-hidden') === 'true', 'Hiding the maximized target never reveals it');
            await change(() => setHidden(false));
            check(!container.current!.querySelector('[aria-label="Restore Plugin pane"]'), 'Revealing a stale target does not re-maximize it');
            check(frame.contentDocument === doc && draft.value === 'Preserved plugin draft', 'Hidden and restored plugin state survives');
            setResult(`${checks.join('\n')}\nALL ${checks.length} CHECKS PASSED`);
        } catch (error) { setResult(`${checks.join('\n')}\nFAIL ${String(error)}`); }
        finally { setRunning(false); }
    };
    return <main className="overlay-gallery space-y-3">
        <h1>Pane maximize / restore</h1>
        <p>Isolated geometry and shared-header check. No real terminals, plugin service or saved settings are used.</p>
        <div className="flex flex-wrap gap-2">
            <Button disabled={running} onClick={() => { void run(); }}>Run maximize checks</Button>
            <Button variant="secondary" disabled={running} onClick={() => setLight(!light)}>Use {light ? 'dark' : 'light'} theme</Button>
            <Button variant="secondary" disabled={running} onClick={() => setNarrow(!narrow)}>Use {narrow ? 'wide' : '320px'} preview</Button>
        </div>
        <div ref={container} className="relative max-w-full" style={{ width: narrow ? 320 : '100%', height: 360 }}>
            <WorkspaceDockingFrame projection={projection} sizes={{ bottom: 0.45 }} renderAllocation={allocation => <Slots node={allocation.layout.root} register={registerSlot} />} />
            <PaneSurfaceLayer surfaces={workspaceDockingSurfaces(canvases, projection, true)} registerHost={registerHost}
                renderSurface={surface => <div className="h-full flex flex-col bg-app-panel border border-app-border">
                    <PaneHeader label={surface.node.id === 'plugin' ? 'Plugin' : 'Shell'} defaultTitle={surface.node.id} icon={<span aria-hidden>□</span>}
                        onPointerDown={() => {}} onRename={() => {}} onClose={() => {}}
                        maximized={projection.maximizedContentId === surface.key}
                        onToggleMaximize={surface.node.id === 'plugin' ? () => setMaximized(value => !value) : undefined} />
                    {surface.node.id === 'plugin' ? <iframe title="Retained plugin probe" className="w-full flex-1 min-h-0 border-0"
                        onLoad={() => { loads.current++; }} srcDoc={'<!doctype html><html><body style="font:14px system-ui;padding:8px"><label>Plugin draft <input id="draft" value="Edit me" style="max-width:90%"></label></body></html>'} />
                        : <p className="p-3 text-xs text-app-muted">Retained terminal stand-in — no PTY</p>}
                </div>} />
        </div>
        <pre role="status" className="whitespace-pre-wrap text-xs">{result}</pre>
    </main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<TooltipProvider><Gallery /></TooltipProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
