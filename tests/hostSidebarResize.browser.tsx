import { Profiler, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { SidebarChrome, SidebarContent } from '../src/components/layout/sidebar/SidebarChrome';
import { ConnectionItem } from '../src/components/layout/sidebar/ConnectionItem';
import { SidebarSection } from '../src/components/layout/sidebar/SidebarSection';
import type { Connection } from '../src/features/connections/domain/types';
import { Button } from '../src/components/ui/Button';
import '../src/index.css';
import './uiOverlays.browser.css';

const noop = () => {};
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Synthetic inventory only. No store writes, connections, provider refreshes or persistence. */
function Gallery() {
    const [count, setCount] = useState(102);
    const [width, setWidth] = useState(288);
    const [running, setRunning] = useState(false);
    const [legacyWidthVariable, setLegacyWidthVariable] = useState(false);
    const [result, setResult] = useState('Ready');
    const preview = useRef<HTMLDivElement>(null);
    const rowCommits = useRef(0);
    const hosts = useMemo<Connection[]>(() => Array.from({ length: count }, (_, index) => ({
        id: `resize-probe-${index}`, name: `Synthetic host ${index + 1} — long display label`,
        host: `host-${index}.example.invalid`, username: 'demo', port: 22, status: 'disconnected', icon: 'Server',
    })), [count]);

    const profile = async () => {
        setRunning(true); setResult('Running comparison…');
        const lines: string[] = [];
        try {
            // Repeat in reverse order to expose warmup/order effects; numbers are
            // diagnostic observations, never timing assertions in the unit suite.
            for (const size of [2, 102, 500, 500, 102, 2]) {
                setCount(size); setWidth(288); await settle();
                const root = preview.current!;
                const handle = root.querySelector<HTMLDivElement>('[role="separator"]')!;
                handle.parentElement!.getAnimations().forEach(animation => animation.finish());
                const capture = [handle.setPointerCapture, handle.hasPointerCapture, handle.releasePointerCapture] as const;
                handle.setPointerCapture = noop; handle.hasPointerCapture = () => true; handle.releasePointerCapture = noop;
                const event = (type: string, x: number) => handle.dispatchEvent(new PointerEvent(type, {
                    bubbles: true, cancelable: true, pointerId: 99, isPrimary: true, button: 0, clientX: x,
                }));
                const samples: number[] = [];
                try {
                    event('pointerdown', 300); await settle();
                    const before = rowCommits.current;
                    for (let frame = 0; frame < 90; frame++) {
                        event('pointermove', 300 + 90 * Math.sin(frame / 9));
                        await new Promise<void>(resolve => requestAnimationFrame(() => {
                            // Optional diagnostic replay of the previous inheritance
                            // contract; production components never set this variable.
                            if (legacyWidthVariable) {
                                const shell = handle.parentElement!;
                                shell.style.setProperty('--sidebar-width', shell.style.width);
                                const content = shell.querySelector<HTMLElement>('[data-sidebar-content]')!;
                                content.style.width = 'var(--sidebar-width)';
                                content.style.minWidth = 'var(--sidebar-width)';
                            }
                            // The production hook's width paint is queued first. This
                            // read then measures style/layout work caused by that paint.
                            const started = performance.now();
                            root.querySelector('[data-neighbour]')!.getBoundingClientRect();
                            if (frame >= 10) samples.push(performance.now() - started);
                            resolve();
                        }));
                    }
                    samples.sort((a, b) => a - b);
                    const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
                    lines.push(`${size} hosts (${legacyWidthVariable ? 'legacy inherited variable' : 'production scoped sizing'}): mean layout ${mean.toFixed(2)}ms; p95 ${samples[Math.floor(samples.length * .95)].toFixed(2)}ms; row commits while dragging ${rowCommits.current - before}`);
                } finally {
                    event('pointerup', 300);
                    handle.parentElement!.style.removeProperty('--sidebar-width');
                    [handle.setPointerCapture, handle.hasPointerCapture, handle.releasePointerCapture] = capture;
                }
                await settle();
                setResult(lines.join('\n'));
            }
            setResult(lines.join('\n') + '\nCOMPARISON COMPLETE — synthetic browser measurements, not desktop terminal profiling');
        } catch (error) { setResult(lines.join('\n') + '\nFAIL ' + String(error)); }
        finally { setRunning(false); }
    };
    return <TooltipProvider><main data-theme="dark" className="min-h-screen bg-app-bg text-app-text p-4 space-y-3">
        <h1>Hosts sidebar — controlled resize cost comparison</h1>
        <p>Real host rows; synthetic inventory. Host actions are inert. Width saves stay in memory.</p>
        <Button disabled={running} onClick={() => { void profile(); }}>Compare host counts</Button>
        <Button disabled={running} onClick={() => setLegacyWidthVariable(!legacyWidthVariable)}>
            Legacy variable replay: {legacyWidthVariable ? 'on' : 'off'} (diagnostic only)
        </Button>
        <pre aria-live="polite" className="text-xs whitespace-pre-wrap">{result}</pre>
        <div ref={preview} className="flex h-96 border border-app-border overflow-hidden">
            <SidebarChrome position="left" collapsed={false} savedWidth={width} onResize={setWidth}>
                <SidebarContent className="flex flex-col flex-1 min-h-0 p-3">
                    <SidebarSection title="All Hosts" count={count} variant="action" fill>
                        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide space-y-0.5 p-2" inert>
                            <Profiler id="host-rows" onRender={() => rowCommits.current++}>
                                {hosts.map(conn => <ConnectionItem key={conn.id} conn={conn} isCollapsed={false}
                                    onEdit={noop} onOpenContextMenu={noop} locations={['local', 'google']} />)}
                            </Profiler>
                        </div>
                    </SidebarSection>
                </SidebarContent>
            </SidebarChrome>
            <div data-neighbour className="flex-1 min-w-0 p-4">Neighbouring workspace area</div>
        </div>
    </main></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(<Gallery />);
