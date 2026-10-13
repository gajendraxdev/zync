import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarChrome, SidebarContent } from '../src/components/layout/sidebar/SidebarChrome';
import { AI_SIDEBAR_WIDTH_LIMITS } from '../src/components/ai/useAiSidebarWidth';
import { Button } from '../src/components/ui/Button';
import { PaneSurfaceLayer } from '../src/components/workspace/PaneSurfaceLayer';
import { layoutSurfaces } from '../src/components/workspace/paneSurfaces';
import { usePaneSurfaceGeometry } from '../src/components/workspace/usePaneSurfaceGeometry';
import '../src/index.css';
import './uiOverlays.browser.css';

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const surfaces = layoutSurfaces({ version: 1, activePaneId: 'draft', root: {
    type: 'split', id: 'split', direction: 'horizontal', sizes: [0.5, 0.5], children: [
        { type: 'pane', id: 'draft', content: { kind: 'plugin', pluginId: 'probe', instanceId: 'draft' } },
        { type: 'pane', id: 'other', content: { kind: 'feature', featureId: 'files', instanceId: 'other' } },
    ],
} }, true);

/** Same disposable slots and stable content hosts as the workspace; no native sessions. */
function AllocatedPanes() {
    const container = useRef<HTMLDivElement>(null);
    const { registerSlot, registerHost } = usePaneSurfaceGeometry(container);
    return <div ref={container} data-resize-workspace className="flex-1 min-w-0 relative overflow-hidden">
        <div className="absolute inset-0 flex">
            {surfaces.map(surface => <div key={surface.key} data-resize-slot={surface.key}
                ref={node => registerSlot(surface.key, node)} className="flex-1 min-w-0" />)}
        </div>
        <PaneSurfaceLayer surfaces={surfaces} registerHost={registerHost} renderSurface={surface => surface.node.id === 'draft'
            ? <iframe title="Retained neighbouring pane" className="w-full h-full border-0"
                srcDoc={'<label>Draft <input value="original"></label>'} />
            : <div className="p-4">Other allocated pane</div>} />
    </div>;
}

/** Production shell and limits, disposable in-memory persistence; no AI requests or native sessions. */
function Gallery() {
    const [primaryWidth, setPrimaryWidth] = useState(260);
    const [aiWidth, setAiWidth] = useState(300);
    const [primarySide, setPrimarySide] = useState<'left' | 'right'>('left');
    const [aiOpen, setAiOpen] = useState(true);
    const [theme, setTheme] = useState('dark');
    const [result, setResult] = useState('Ready');
    const [running, setRunning] = useState(false);
    const preview = useRef<HTMLDivElement>(null);
    const commits = useRef({ primary: 0, ai: 0 });
    useEffect(() => { document.body.dataset.overlayGalleryTheme = theme; document.body.dataset.theme = theme; }, [theme]);
    const run = async () => {
        setRunning(true); setResult('Running');
        setPrimaryWidth(260); setAiWidth(300);
        const results: string[] = [];
        const check = (condition: unknown, message: string) => {
            if (!condition) throw Error(message);
            results.push('PASS ' + message);
        };
        try {
            await settle();
            const root = preview.current!;
            // Start repeated runs from saved widths, not halfway through their reset transition.
            root.querySelectorAll('[data-shared-sidebar]').forEach(shell => shell.getAnimations().forEach(animation => animation.finish()));
            const frame = root.querySelector('iframe')!;
            const original = frame.contentDocument;
            const draft = original!.querySelector('input')!;
            draft.value = 'retained while resizing';
            for (const side of ['left', 'right'] as const) {
                setPrimarySide(side); setAiOpen(true); await settle();
                for (const kind of ['primary', 'ai'] as const) {
                    const label = kind === 'primary' ? 'Resize primary sidebar' : 'Resize AI panel';
                    const handle = root.querySelector<HTMLDivElement>(`[aria-label="${label}"]`)!;
                    const shell = handle.parentElement!;
                    const startWidth = shell.getBoundingClientRect().width;
                    const before = commits.current[kind];
                    const direction = kind === 'ai' || side === 'right' ? -1 : 1;
                    let deliveries = 0;
                    let staleAllocations = 0;
                    // Registered after the production observer: inspect its result before paint,
                    // not after settle() has hidden a deferred-frame geometry error.
                    const allocationObserver = new ResizeObserver(() => {
                        deliveries++;
                        for (const slot of root.querySelectorAll<HTMLElement>('[data-resize-slot]')) {
                            const host = Array.from(root.querySelectorAll<HTMLElement>('[data-pane-surface]'))
                                .find(node => node.dataset.paneSurface === slot.dataset.resizeSlot)!;
                            const expected = slot.getBoundingClientRect();
                            const actual = host.getBoundingClientRect();
                            if ((['left', 'top', 'width', 'height'] as const).some(key =>
                                Math.abs(actual[key] - expected[key]) > 0.05)) staleAllocations++;
                        }
                    });
                    root.querySelectorAll('[data-resize-slot]').forEach(slot => allocationObserver.observe(slot));
                    // Synthetic test events cannot own a native pointer; restore these methods afterwards.
                    const capture = [handle.setPointerCapture, handle.hasPointerCapture, handle.releasePointerCapture] as const;
                    handle.setPointerCapture = () => {};
                    handle.hasPointerCapture = () => true;
                    handle.releasePointerCapture = () => {};
                    const event = (type: string, distance: number) => handle.dispatchEvent(new PointerEvent(type, {
                        bubbles: true, cancelable: true, pointerId: 99, isPrimary: true, button: 0,
                        clientX: 500 + direction * distance,
                    }));
                    try {
                        event('pointerdown', 0); await settle();
                        event('pointermove', 0); await settle();
                        check(Math.abs(parseFloat(shell.style.width) - startWidth) < 0.01, `${kind} ${side}: grab offset is stable`);
                        event('pointermove', 40.25); await settle();
                        check(Math.abs(parseFloat(shell.style.width) - startWidth - 40.25) < 0.01, `${kind} ${side}: live subpixel width follows the pointer`);
                        const content = shell.querySelector<HTMLElement>('[data-sidebar-content]')!;
                        check(content.style.width === shell.style.width && content.style.minWidth === shell.style.width
                            && shell.style.getPropertyValue('--sidebar-width') === '', `${kind} ${side}: shared content tracks width without an inherited resize variable`);
                        check(deliveries > 0 && staleAllocations === 0, `${kind} ${side}: both pane allocations match their slots before paint`);
                        check(commits.current[kind] === before, `${kind} ${side}: no save during dragging`);
                        check(getComputedStyle(shell).transitionProperty === 'all' && getComputedStyle(shell).transitionDuration === '0s', `${kind} ${side}: live drag has no width transition`);
                        for (const distance of [42.5, 47.25, 35.5, 50.75]) {
                            event('pointermove', distance); await settle();
                        }
                        check(staleAllocations === 0, `${kind} ${side}: consecutive inward and outward frames stay aligned`);
                        event('pointermove', 50.75); event('pointerup', 50.75); await settle();
                        check(commits.current[kind] === before + 1 && Number.isInteger(Number(handle.getAttribute('aria-valuenow'))), `${kind} ${side}: final integer width saves exactly once`);
                        check(Math.abs(shell.getBoundingClientRect().width - Number(handle.getAttribute('aria-valuenow'))) < 0.01, `${kind} ${side}: release paints the final width without animated catch-up`);
                        check(original === frame.contentDocument && draft.value === 'retained while resizing', `${kind} ${side}: neighbouring iframe retains its document and state`);
                    } finally {
                        allocationObserver.disconnect();
                        event('pointercancel', 0);
                        [handle.setPointerCapture, handle.hasPointerCapture, handle.releasePointerCapture] = capture;
                    }
                }
            }
            const aiShell = root.querySelector<HTMLElement>('[aria-label="AI Assistant"]')!;
            const aiContent = aiShell.querySelector<HTMLElement>('[data-sidebar-content]')!;
            const contentWidth = aiContent.style.width;
            setAiOpen(false); await settle();
            check(!root.querySelector('[aria-label="Resize AI panel"]'), 'Closed AI has no focusable resize handle');
            check(aiShell.inert && aiContent.inert, 'Collapsed content is inert');
            check(aiContent.style.width === contentWidth && aiContent.style.minWidth === contentWidth, 'Collapse preserves the content width');
            setAiOpen(true); await settle();
            check(aiShell.querySelector('[data-sidebar-content]') === aiContent && aiContent.style.width === contentWidth
                && !aiShell.inert && !aiContent.inert, 'Reopening retains the same content wrapper and width');
            const aiHandle = root.querySelector<HTMLDivElement>('[aria-label="Resize AI panel"]')!;
            const before = Number(aiHandle.getAttribute('aria-valuenow'));
            aiHandle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); await settle();
            check(Number(aiHandle.getAttribute('aria-valuenow')) === before + 16, 'AI supports the same inward keyboard resize');
            setResult(results.join('\n') + `\nALL ${results.length} CHECKS PASSED`);
        } catch (error) { setResult(results.join('\n') + '\nFAIL ' + String(error)); }
        finally { setRunning(false); }
    };
    return <main data-theme={theme} className="min-h-screen bg-app-bg text-app-text p-4 space-y-3">
        <h1>Primary navigation and secondary AI — shared resize shell</h1>
        <p>No native operations. Drag either separator to compare behaviour; the adjacent draft must stay intact.</p>
        <div className="flex gap-2 flex-wrap">
            <Button disabled={running} onClick={() => { void run(); }}>Run shared resize checks</Button>
            <Button onClick={() => setPrimarySide(primarySide === 'left' ? 'right' : 'left')}>Move primary sidebar</Button>
            <Button onClick={() => setAiOpen(!aiOpen)}>Toggle AI</Button>
            <Button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Change theme</Button>
        </div>
        <output>{result.split('\n').at(-1)}</output>
        <pre aria-live="polite" className="text-xs max-h-56 overflow-auto whitespace-pre-wrap">{result}</pre>
        <div ref={preview} className="flex h-80 border border-app-border overflow-hidden">
            <SidebarChrome position={primarySide} collapsed={false} savedWidth={primaryWidth} resizeLabel="Resize primary sidebar"
                onResize={value => { commits.current.primary++; setPrimaryWidth(value); }}>
                <SidebarContent className="p-4">Hosts / Workspace / Plugins</SidebarContent>
            </SidebarChrome>
            <AllocatedPanes />
            <SidebarChrome position="right" order={2} collapsed={!aiOpen} savedWidth={aiWidth} widthLimits={AI_SIDEBAR_WIDTH_LIMITS}
                resizeLabel="Resize AI panel" landmarkLabel="AI Assistant" onResize={value => { commits.current.ai++; setAiWidth(value); }}>
                <SidebarContent className="p-4" inert={!aiOpen}>AI Assistant</SidebarContent>
            </SidebarChrome>
        </div>
    </main>;
}
createRoot(document.getElementById('root')!).render(<Gallery />);
