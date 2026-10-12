import { useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PaneSurfaceLayer } from '../src/components/workspace/PaneSurfaceLayer';
import { layoutSurfaces, projectedLayoutSurfaces, paneSurfaceKey, type PaneSurface } from '../src/components/workspace/paneSurfaces';
import { usePaneSurfaceGeometry } from '../src/components/workspace/usePaneSurfaceGeometry';
import type { PaneLayout, PaneLeaf } from '../src/lib/paneLayout';
import { releasePaneFromGroups } from '../src/lib/paneLayout/groups';
import { usePluginPaneNavigation } from '../src/components/layout/usePluginPaneNavigation';
import type { PaneLayoutGroups } from '../src/lib/paneLayout';
import { canSplit, projectVisiblePaneLayout } from '../src/lib/paneLayout';

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

const NO_HIDDEN_CONTENT: ReadonlySet<string> = new Set();
function Scenario({ layouts, visible = true, hidden = NO_HIDDEN_CONTENT }: { layouts: PaneLayout[]; visible?: boolean; hidden?: ReadonlySet<string> }) {
    const container = useRef<HTMLDivElement>(null);
    const { registerSlot, registerHost } = usePaneSurfaceGeometry(container);
    const surfaces = layouts.flatMap(layout => projectedLayoutSurfaces(layout, projectVisiblePaneLayout(layout, hidden), visible));
    return <div ref={container} style={{ position: 'relative', width: 800, height: 400 }}>
        {visible && <div style={{ display: 'flex', position: 'absolute', inset: 0 }}>
            {surfaces.filter(surface => surface.visible).map(surface => <div key={surface.node.id} ref={node => registerSlot(surface.key, node)} style={{ flex: 1 }} />)}
        </div>}
        <PaneSurfaceLayer surfaces={surfaces} registerHost={registerHost} renderSurface={surface => <Probe surface={surface} />} />
    </div>;
}

function NavigationProbe({ state, active, pins }: { state: {
    view: string;
    paneLayouts: Record<string, PaneLayoutGroups | undefined>;
    activePaneGroupOwner: Record<string, string | null>;
    ensurePluginPane: (connectionId: string, panelId: string) => void;
    activatePaneGroup: (connectionId: string, owner: string) => void;
}; active: boolean; pins: string[] }) {
    usePluginPaneNavigation({ connectionId: 'local', view: state.view, groups: state.paneLayouts.local,
        pinnedFeatures: pins, isActive: active, getState: () => state, onMissingView: () => { state.view = 'terminal'; } });
    return null;
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
        const duplicateFrame = frames[1];
        const duplicateWindow = duplicateFrame.contentWindow;
        const released = releasePaneFromGroups({ 'test-instance': pair(plugin, duplicate) }, plugin.id)!;
        flushSync(() => root.render(<Scenario layouts={Object.values(released.groups)} />));
        await settle();
        check(document.querySelectorAll('iframe')[0] === iframe && duplicateFrame.isConnected && duplicateFrame.contentWindow === duplicateWindow,
            'Atomic unsplit and owner promotion preserve both same-panel iframe instances');
        check(iframe.contentWindow === frameWindow && iframe.contentDocument?.querySelector('input') === input && input.value === 'preserved',
            'Unsplit preserves the original iframe document and edited state');
        const shell: PaneLeaf = { type: 'pane', id: 'shell-pane', content: { kind: 'term', termId: 'shell' } };
        const capped: PaneLayout = { version: 1, activePaneId: plugin.id, root: {
            type: 'split', id: 'outer-split', direction: 'vertical', sizes: [0.4, 0.6],
            children: [pair(plugin, files).root, { ...pair(duplicate, shell).root, id: 'other-split' }],
        } };
        const canonicalSnapshot = JSON.stringify(capped);
        flushSync(() => root.render(<Scenario layouts={[capped]} />));
        await settle();
        const partialHidden = new Set([paneSurfaceKey(plugin), paneSurfaceKey(files)]);
        flushSync(() => root.render(<Scenario layouts={[capped]} hidden={partialHidden} />));
        await settle();
        check(iframe.isConnected && iframe.getBoundingClientRect().width === 0 && duplicateFrame.getBoundingClientRect().width > 0,
            'Partial hide retains the hidden iframe and allocates only surviving panes');
        check(iframe.parentElement?.inert && !duplicateFrame.parentElement?.inert,
            'Only hidden retained hosts become inert');
        iframe.focus();
        check(document.activeElement !== iframe, 'Hidden retained iframe cannot receive programmatic focus');
        check(iframe.contentWindow === frameWindow && iframe.contentDocument?.querySelector('input') === input && input.value === 'preserved',
            'Partial hide preserves the iframe document and edited state');
        const allHidden = new Set(layoutSurfaces(capped, true).map(surface => surface.key));
        flushSync(() => root.render(<Scenario layouts={[capped]} hidden={allHidden} />));
        await settle();
        check(iframe.isConnected && duplicateFrame.isConnected && document.querySelectorAll('[data-pane-surface]').length === 4,
            'All-hidden keeps the complete visited canonical host inventory');
        check(Array.from(document.querySelectorAll<HTMLElement>('[data-pane-surface]')).every(host => host.inert && host.getBoundingClientRect().width === 0),
            'All-hidden has no focusable or visible content slots');
        check(!canSplit(capped) && JSON.stringify(capped) === canonicalSnapshot,
            'Hiding never changes the canonical four-pane capacity or saved tree');
        flushSync(() => root.render(<Scenario layouts={[capped]} />));
        await settle();
        check(document.querySelectorAll('iframe')[0] === iframe && document.querySelectorAll('iframe')[1] === duplicateFrame
            && iframe.contentWindow === frameWindow && duplicateFrame.contentWindow === duplicateWindow,
            'Reveal preserves both iframe nodes and browsing contexts in retained mount order');
        check(iframe.contentDocument?.querySelector('input') === input && input.value === 'preserved' && frameLoads === initialLoads,
            'Hide and reveal never reload the iframe or reset its edited state');
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
        let openRequests = 0;
        const navigation = {
            view: 'plugin:test',
            paneLayouts: { local: { 'test-instance': single(plugin) } } as Record<string, PaneLayoutGroups | undefined>,
            activePaneGroupOwner: { local: 'test-instance' } as Record<string, string | null>,
            ensurePluginPane: () => {
                openRequests++;
                if (Object.keys(navigation.paneLayouts.local ?? {}).length === 0) navigation.paneLayouts.local = { 'test-instance': single(plugin) };
            },
            activatePaneGroup: (_connectionId: string, owner: string) => { navigation.activePaneGroupOwner.local = owner; },
        };
        flushSync(() => root.render(<NavigationProbe state={navigation} active pins={[]} />));
        await settle();
        check(openRequests === 1, 'Restored plugin routing makes one explicit bootstrap request');
        navigation.paneLayouts.local = {};
        navigation.activePaneGroupOwner.local = null;
        flushSync(() => root.render(<NavigationProbe state={navigation} active pins={[]} />));
        await settle();
        flushSync(() => root.render(<NavigationProbe state={navigation} active={false} pins={[]} />));
        await settle();
        flushSync(() => root.render(<NavigationProbe state={navigation} active pins={[]} />));
        await settle();
        check(openRequests === 1 && Object.keys(navigation.paneLayouts.local ?? {}).length === 0 && navigation.view === 'terminal',
            'Pane-header removal followed by main-tab reactivation never reopens the closed plugin');
        flushSync(() => root.render(<NavigationProbe state={navigation} active pins={['plugin:test']} />));
        await settle();
        check(openRequests === 2 && Object.keys(navigation.paneLayouts.local ?? {}).length === 1,
            'A newly pinned plugin remains an explicit open request');
        results.textContent += '\nALL CHECKS PASSED';
    } catch (error) {
        results.textContent += `\nFAIL ${String(error)}`;
    }
};
