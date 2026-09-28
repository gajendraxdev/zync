import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PaneSurfaceLayer } from '../src/components/workspace/PaneSurfaceLayer';
import { layoutSurfaces, paneSurfaceKey, type PaneSurface } from '../src/components/workspace/paneSurfaces';
import { usePaneSurfaceGeometry } from '../src/components/workspace/usePaneSurfaceGeometry';
import type { PaneLayout, PaneLeaf } from '../src/lib/paneLayout';

const style = document.createElement('style');
style.textContent = '.absolute{position:absolute}.overflow-hidden{overflow:hidden}.z-10{z-index:10} iframe{width:100%;height:100%;border:0}';
document.head.append(style);
const root = createRoot(document.querySelector('#root')!);
const results = document.querySelector('#results')!;
const mounts = new Map<string, number>();
const disposals = new Map<string, number>();
let frameLoads = 0;
const plugin: PaneLeaf = { type: 'pane', id: 'plugin-pane', content: { kind: 'plugin', pluginId: 'test', instanceId: 'test-instance' } };
const files: PaneLeaf = { type: 'pane', id: 'files-pane', content: { kind: 'feature', featureId: 'files', instanceId: 'files-instance' } };
const single = (leaf: PaneLeaf): PaneLayout => ({ version: 1, root: leaf, activePaneId: leaf.id });
const pair = (first: PaneLeaf, second: PaneLeaf): PaneLayout => ({
    version: 1, activePaneId: first.id,
    root: { type: 'split', id: 'split', direction: 'horizontal', sizes: [0.5, 0.5], children: [first, second] },
});

function Probe({ surface }: { surface: PaneSurface }) {
    useEffect(() => {
        mounts.set(surface.key, (mounts.get(surface.key) ?? 0) + 1);
        return () => { disposals.set(surface.key, (disposals.get(surface.key) ?? 0) + 1); };
    }, [surface.key]);
    return surface.node.content.kind === 'plugin'
        ? <iframe title="Lifecycle probe" srcDoc='<input aria-label="Saved state" value="initial">' onLoad={() => {
            if (surface.key === paneSurfaceKey(plugin)) frameLoads++;
        }} />
        : <div>Other pane</div>;
}

function Scenario({ layouts, visible = true }: { layouts: PaneLayout[]; visible?: boolean }) {
    const container = useRef<HTMLDivElement>(null);
    const { registerSlot, registerHost } = usePaneSurfaceGeometry(container);
    const surfaces = layouts.flatMap(layout => layoutSurfaces(layout, visible));
    return <div ref={container} style={{ position: 'relative', width: 800, height: 400 }}>
        {visible && <div style={{ display: 'flex', position: 'absolute', inset: 0 }}>
            {surfaces.map(surface => <div key={surface.node.id} ref={node => registerSlot(surface.key, node)} style={{ flex: 1 }} />)}
        </div>}
        <PaneSurfaceLayer surfaces={surfaces} registerHost={registerHost} renderSurface={surface => <Probe surface={surface} />} />
    </div>;
}

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function check(condition: unknown, label: string) {
    if (!condition) throw new Error(label);
    results.textContent += `\nPASS ${label}`;
}

document.querySelector<HTMLButtonElement>('#run')!.onclick = async () => {
    results.textContent = 'Running';
    try {
        flushSync(() => root.render(null));
        mounts.clear();
        disposals.clear();
        frameLoads = 0;
        flushSync(() => root.render(<Scenario layouts={[single(plugin)]} />));
        await settle();
        const iframe = document.querySelector('iframe')!;
        if (!iframe.contentDocument?.querySelector('input')) {
            await new Promise<void>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('Probe frame did not load')), 3000);
                iframe.addEventListener('load', () => { clearTimeout(timer); resolve(); }, { once: true });
            });
        }
        const input = iframe.contentDocument!.querySelector('input')!;
        input.value = 'preserved';
        const frameWindow = iframe.contentWindow;
        const initialLoads = frameLoads;
        for (const layouts of [[pair(plugin, files)], [pair(files, plugin)], [single(files), single(plugin)], [single(plugin)]]) {
            flushSync(() => root.render(<Scenario layouts={layouts} />));
            await settle();
            check(document.querySelector('iframe') === iframe, 'Frame node survives split, reorder, owner transfer or collapse');
            check(iframe.contentWindow === frameWindow && iframe.contentDocument?.querySelector('input') === input && input.value === 'preserved', 'Frame document, state and browsing context survive');
            check(iframe.getBoundingClientRect().width > 0, 'The stable host receives its allocated rectangle');
        }
        const duplicate: PaneLeaf = { ...plugin, id: 'duplicate-pane', content: { kind: 'plugin', pluginId: 'test', instanceId: 'duplicate-instance' } };
        flushSync(() => root.render(<Scenario layouts={[pair(plugin, duplicate)]} />));
        await settle();
        const frames = document.querySelectorAll('iframe');
        check(frames.length === 2 && frames[0] === iframe && frames[1].contentWindow !== frameWindow, 'Duplicating creates an independent frame without replacing the original');
        const container = document.querySelector<HTMLDivElement>('#root > div')!;
        container.style.width = '1000px';
        await settle();
        check(iframe.getBoundingClientRect().width === 500, 'ResizeObserver follows allocation changes');
        flushSync(() => root.render(<Scenario layouts={[single(plugin)]} />));
        await settle();
        check(disposals.get(paneSurfaceKey(duplicate)) === 1 && document.querySelector('iframe') === iframe, 'Closing a sibling preserves the surviving frame');
        flushSync(() => root.render(<Scenario layouts={[single(plugin)]} visible={false} />));
        await settle();
        check(iframe.isConnected && iframe.getBoundingClientRect().width === 0, 'Hidden content stays mounted without occupying the canvas');
        flushSync(() => root.render(<Scenario layouts={[single(plugin)]} />));
        await settle();
        check(frameLoads === initialLoads, 'Layout changes never reload the iframe');
        check(mounts.get(paneSurfaceKey(plugin)) === 1, 'Plugin content mounted exactly once');
        flushSync(() => root.render(<Scenario layouts={[]} />));
        await settle();
        check(!iframe.isConnected && disposals.get(paneSurfaceKey(plugin)) === 1, 'Closing disposes content exactly once');
        results.textContent += '\nALL CHECKS PASSED';
    } catch (error) {
        results.textContent += `\nFAIL ${String(error)}`;
    }
};
