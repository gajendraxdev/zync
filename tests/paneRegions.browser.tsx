import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { PaneSurfaceLayer } from '../src/components/workspace/PaneSurfaceLayer';
import { WorkspaceDockingFrame } from '../src/components/workspace/WorkspaceDockingFrame';
import { workspaceDockingSurfaces } from '../src/components/workspace/workspaceDockingSurfaces';
import { projectWorkspaceDocking } from '../src/features/workspace/domain/dockingProjection';
import type { DockedPaneRegion } from '../src/features/workspace/domain/docking';
import { workspaceDockingRects } from '../src/features/workspace/domain/dockingNavigation';
import { dockTargetFromPointer } from '../src/components/layout/tabDock/hit';
import { useDockTabPointer, type DockTabPointerHandlers } from '../src/components/layout/tabDock/useDockTabPointer';
import { getTabDockLive, patchTabDockTarget, startTabDock, stopTabDock, subscribeTabDock } from '../src/components/layout/tabDock/session';
import { TabDockOverlay } from '../src/components/layout/tabDock/TabDockOverlay';
import { RegionDropGuides } from '../src/components/workspace/RegionDropGuides';
import { collectLeaves, paneContentKey, paneDockPayload } from '../src/lib/paneLayout';
import { workspacePaneForDockPayload } from '../src/features/workspace/domain/canvases';
import type { WorkspaceCanvas } from '../src/features/workspace/domain/canvases';
import { usePaneSurfaceGeometry } from '../src/components/workspace/usePaneSurfaceGeometry';
import { paneSurfaceKey, type PaneSurface } from '../src/components/workspace/paneSurfaces';
import { movePaneRegion, PANE_REGIONS, PANE_REGION_SIZE_RULES, type PaneRegion, type PaneRegionAssignments, type PaneRegionSizes } from '../src/lib/paneLayout/regions';
import { isPaneLeaf } from '../src/lib/paneLayout/query';
import type { PaneLayout, PaneLeaf, PaneNode } from '../src/lib/paneLayout/types';
import { Button } from '../src/components/ui/Button';
import '../src/index.css';
import './uiOverlays.browser.css';

const leaves: PaneLeaf[] = [
    { type: 'pane', id: 'terminal', content: { kind: 'term', termId: 'terminal' } },
    { type: 'pane', id: 'files', content: { kind: 'feature', featureId: 'files', instanceId: 'files' } },
    { type: 'pane', id: 'plugin', content: { kind: 'plugin', pluginId: 'sample', instanceId: 'plugin' } },
    { type: 'pane', id: 'other-plugin', content: { kind: 'plugin', pluginId: 'sample', instanceId: 'other-plugin' } },
];
const pair = (id: string, first: PaneNode, second: PaneNode): PaneNode => ({ type: 'split', id, direction: 'horizontal', sizes: [0.5, 0.5], children: [first, second] });
const canonical: PaneLayout = { version: 1, activePaneId: 'plugin', root: pair('root', pair('left', leaves[0], leaves[1]), pair('right', leaves[2], leaves[3])) };
const crossCanvases = [
    { owner: 'first', layout: { version: 1 as const, activePaneId: 'terminal', root: pair('first-split', leaves[0], leaves[1]) } },
    { owner: 'second', layout: { version: 1 as const, activePaneId: 'other-plugin', root: pair('second-split', leaves[2], leaves[3]) } },
];
const pluginKey = paneSurfaceKey(leaves[2]);
const initialHidden = new Set(leaves.filter(leaf => leaf.id !== 'plugin').map(paneSurfaceKey));
const emptyAssignments: PaneRegionAssignments = new Map();
const counts = { mounts: new Map<string, number>(), disposals: new Map<string, number>(), loads: new Map<string, number>() };
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Test resources, not native terminals or plugin workers. Real iframes detect reparent/reload regressions. */
function ResourceProbe({ surface, dockPointer }: { surface: PaneSurface; dockPointer: DockTabPointerHandlers }) {
    const { begin } = useDockTabPointer(dockPointer);
    useEffect(() => {
        counts.mounts.set(surface.key, (counts.mounts.get(surface.key) ?? 0) + 1);
        return () => { counts.disposals.set(surface.key, (counts.disposals.get(surface.key) ?? 0) + 1); };
    }, [surface.key]);
    return <div data-pane-id={surface.node.id} data-pane-content-id={surface.key}
        className="flex flex-col h-full min-w-0 bg-app-panel border border-app-border">
        <div data-probe-drag={surface.node.id} onPointerDown={event => begin(event, paneDockPayload(surface.node))}
            className="text-xs px-2 py-1 truncate select-none">{surface.node.id} — retained host</div>
        {surface.node.content.kind === 'plugin' ? <iframe title={surface.node.id} className="w-full flex-1 min-h-0 border-0"
            srcDoc='<!doctype html><html><body style="margin:8px;font:12px system-ui"><label>Plugin draft <input id="draft" value="initial" style="max-width:95%"></label></body></html>'
            onLoad={() => counts.loads.set(surface.key, (counts.loads.get(surface.key) ?? 0) + 1)} />
            : <div className="p-2 text-xs text-app-muted">Resource lifecycle probe</div>}
    </div>;
}

/** A slot-only tree: intentionally no store, resizer, terminal or plugin service. */
function Slots({ node, register }: { node: PaneNode; register: (id: string, element: HTMLDivElement | null) => void }) {
    if (isPaneLeaf(node)) return <div data-region-slot={paneSurfaceKey(node)} ref={element => register(paneSurfaceKey(node), element)} className="w-full h-full min-w-0 min-h-0" />;
    return <div className="flex w-full h-full min-w-0 min-h-0" style={{ flexDirection: node.direction === 'vertical' ? 'column' : 'row' }}>
        {node.children.map((child, index) => <div key={child.id} className="min-w-0 min-h-0" style={{ flex: `${node.sizes[index]} 1 0` }}>
            <Slots node={child} register={register} />
        </div>)}
    </div>;
}

function Canvas({ layout, assignments, hidden, visible, sizes, crossCanvas, activeCanvas, onResize, onDrop }: {
    layout: PaneLayout; assignments: PaneRegionAssignments; hidden: ReadonlySet<string>; visible: boolean; sizes: Partial<PaneRegionSizes>;
    crossCanvas: boolean; activeCanvas: string;
    onResize: (region: DockedPaneRegion, size: number) => boolean;
    onDrop: (contentId: string, region: PaneRegion) => void;
}) {
    const container = useRef<HTMLDivElement>(null);
    const { registerSlot, registerHost } = usePaneSurfaceGeometry(container);
    const canvases = crossCanvas ? crossCanvases : [{ owner: 'primary', layout }];
    const payload = useSyncExternalStore(subscribeTabDock, () => getTabDockLive()?.payload ?? null, () => null);
    const result = projectWorkspaceDocking(canvases, assignments, hidden, crossCanvas ? activeCanvas : 'primary', pluginKey);
    if (!result.ok) return <div role="alert">Allocation rejected: {result.reason}</div>;
    const projection = result.value;
    const source = payload ? workspacePaneForDockPayload(canvases, payload) : null;
    const sourceId = source?.ok && source.pane ? paneSurfaceKey(source.pane.leaf) : null;
    const occupied = new Set(PANE_REGIONS.filter(region => projection.regions[region].length));
    const remaining = new Set(PANE_REGIONS.filter(region => projection.regions[region].some(allocation =>
        // This fixture has at most four probes; the real adapter also checks registration, capacity and write readiness.
        collectLeaves(allocation.layout.root).some(leaf => paneSurfaceKey(leaf) !== sourceId))));
    const dockPointer: DockTabPointerHandlers = {
        contextId: 'region-fixture', isEnabled: () => visible, getSurface: () => container.current,
        onDragStart: () => {}, onDragCancel: () => {}, onDragEnd: (payload, target) => {
            const source = workspacePaneForDockPayload(canvases, payload);
            if (target?.kind === 'region' && source.ok && source.pane) onDrop(paneContentKey(source.pane.leaf.content, source.pane.leaf.id), target.region);
        },
    };
    return <div ref={container} data-probe-canvas="" className="relative h-full min-w-0 min-h-0">
        {visible && <WorkspaceDockingFrame projection={projection} sizes={sizes} onResize={onResize}
            renderAllocation={allocation => <Slots node={allocation.layout.root} register={registerSlot} />}
            emptyWorkspace={<span className="text-xs text-app-muted">Workspace / recovery area</span>} />}
        <PaneSurfaceLayer surfaces={workspaceDockingSurfaces(canvases, projection, visible)} registerHost={registerHost}
            renderSurface={surface => <ResourceProbe surface={surface} dockPointer={dockPointer} />} />
        {visible && sourceId && <RegionDropGuides destinations={PANE_REGIONS.filter(region => !occupied.has(region))} occupied={remaining} sizes={sizes} />}
        <TabDockOverlay />
    </div>;
}

function Gallery() {
    const [assignments, setAssignments] = useState(emptyAssignments);
    const [hidden, setHidden] = useState<ReadonlySet<string>>(initialHidden);
    const [visible, setVisible] = useState(true);
    const [layout, setLayout] = useState(canonical);
    const [sizes, setSizes] = useState<Partial<PaneRegionSizes>>({});
    const [width, setWidth] = useState<number | undefined>(undefined);
    const [theme, setTheme] = useState('dark');
    const [result, setResult] = useState('Ready');
    const [running, setRunning] = useState(false);
    const [scenario, setScenario] = useState(0);
    const [crossCanvas, setCrossCanvas] = useState(false);
    const [activeCanvas, setActiveCanvas] = useState('first');
    const preview = useRef<HTMLDivElement>(null);
    const themeControl = useRef<HTMLButtonElement>(null);
    const resizeSaves = useRef(0);
    const refuseResize = useRef(false);
    const resize = (region: DockedPaneRegion, size: number) => {
        if (refuseResize.current) return false;
        resizeSaves.current++;
        setSizes(previous => ({ ...previous, [PANE_REGION_SIZE_RULES[region].key]: size }));
        return true;
    };
    useEffect(() => { document.body.dataset.overlayGalleryTheme = theme; }, [theme]);
    const move = (region: PaneRegion) => setAssignments(previous => {
        const result = movePaneRegion(layout, previous, pluginKey, region, PANE_REGIONS);
        return result.ok ? result.assignments : previous;
    });
    const run = async () => {
        setRunning(true); setResult('Running'); const results: string[] = [];
        const check = (condition: unknown, message: string) => { if (!condition) throw Error(message); results.push(`PASS ${message}`); };
        const change = async (action: () => void) => { flushSync(action); await settle(); };
        const checkNavigationGeometry = (canvases: readonly WorkspaceCanvas[], placements: PaneRegionAssignments,
            selected: string, sizes: Partial<PaneRegionSizes>, label: string) => {
            const projected = projectWorkspaceDocking(canvases, placements, new Set(), selected);
            if (!projected.ok) throw Error('Navigation fixture allocation was refused');
            const canvasBox = preview.current!.querySelector<HTMLElement>('[data-probe-canvas]')!.getBoundingClientRect();
            const slots = Array.from(preview.current!.querySelectorAll<HTMLElement>('[data-region-slot]'));
            const rects = workspaceDockingRects(projected.value, sizes);
            check(rects.length === slots.length && rects.every(rect => {
                const box = slots.find(slot => slot.dataset.regionSlot === rect.id)?.getBoundingClientRect();
                return box && Math.abs(box.left - canvasBox.left - rect.x * canvasBox.width) < 1
                    && Math.abs(box.top - canvasBox.top - rect.y * canvasBox.height) < 1
                    && Math.abs(box.width - rect.w * canvasBox.width) < 1
                    && Math.abs(box.height - rect.h * canvasBox.height) < 1;
            }), `${label}: keyboard navigation rectangles match rendered pane slots`);
        };
        try {
            // Each run starts with fresh disposable probes; identity checks begin after this reset.
            await change(() => { setScenario(value => value + 1); setLayout(canonical); setAssignments(emptyAssignments); setHidden(initialHidden); setVisible(true); setSizes({}); setWidth(undefined); setCrossCanvas(false); setActiveCanvas('first'); });
            const frame = preview.current!.querySelector<HTMLIFrameElement>('iframe[title="plugin"]')!;
            if (!frame.contentDocument?.getElementById('draft')) await new Promise<void>((resolve, reject) => {
                const onLoad = () => { clearTimeout(timer); resolve(); };
                const timer = setTimeout(() => { frame.removeEventListener('load', onLoad); reject(Error('Iframe did not load')); }, 3000);
                frame.addEventListener('load', onLoad, { once: true });
            });
            const originalDocument = frame.contentDocument!;
            const draft = originalDocument.getElementById('draft') as HTMLInputElement;
            draft.value = 'Preserved across docking'; draft.focus();
            const parent = frame.parentElement!; const host = frame.closest<HTMLElement>('[data-pane-surface]')!;
            const hostParent = host.parentElement;
            const initialLoads = counts.loads.get(pluginKey); const initialMounts = counts.mounts.get(pluginKey);
            check(preview.current!.querySelectorAll('[data-pane-surface]').length === 1, 'Unvisited hidden panes remain lazy');
            await change(() => startTabDock(paneDockPayload(leaves[2]), 'region-fixture'));
            const guides = Array.from(preview.current!.querySelectorAll<HTMLElement>('[data-workspace-drop-region]'));
            check(guides.length === 3, 'Dragging exposes only empty peripheral region guides');
            for (const guide of guides) {
                const box = guide.getBoundingClientRect();
                const hit = dockTargetFromPointer(box.left + box.width / 2, box.top + box.height / 2,
                    preview.current!.querySelector<HTMLElement>('[data-probe-canvas]')!);
                check(hit?.kind === 'region' && hit.region === guide.dataset.workspaceDropRegion,
                    `${guide.dataset.workspaceDropRegion}: explicit guide takes precedence over a pane edge`);
                await change(() => patchTabDockTarget(hit));
                const badge = preview.current!.querySelector<HTMLElement>('[data-pane-drop-mode="dock"]');
                check(badge?.textContent?.includes('Dock ') && badge.textContent.includes('Stays visible across tabs'),
                    `${guide.dataset.workspaceDropRegion}: preview identifies persistent docking rather than grouping`);
            }
            await change(() => stopTabDock());
            check(preview.current!.querySelectorAll('[data-workspace-drop-region]').length === 0, 'Drop guides disappear without retaining a drag session');
            const paneBox = host.getBoundingClientRect();
            const paneHit = dockTargetFromPointer(paneBox.left + 2, paneBox.top + paneBox.height / 2,
                preview.current!.querySelector<HTMLElement>('[data-probe-canvas]')!);
            await change(() => { startTabDock(paneDockPayload(leaves[2]), 'region-fixture'); patchTabDockTarget(paneHit); });
            check(preview.current!.querySelector('[data-pane-drop-mode="split"]')?.textContent?.includes('Group panes in this tab'),
                'Pane-edge preview explicitly describes tab-group splitting');
            await change(() => stopTabDock());
            for (const region of ['primary-sidebar', 'secondary-sidebar', 'bottom-panel', 'workspace'] as const) {
                await change(() => move(region));
                const slot = preview.current!.querySelector<HTMLElement>('[data-region-slot]')!;
                const box = slot.getBoundingClientRect(); const allocated = host.getBoundingClientRect();
                check(slot.closest('[data-pane-region]')?.getAttribute('data-pane-region') === region, `${region}: allocation reaches requested area`);
                const canvas = preview.current!.querySelector<HTMLElement>('[data-probe-canvas]')!;
                const target = dockTargetFromPointer(allocated.left + 2, allocated.top + allocated.height / 2, canvas);
                check(target?.kind === 'pane' && target.contentId === pluginKey && target.edge === 'left', `${region}: pointer target resolves the retained content identity`);
                check(Math.abs(box.left - allocated.left) < 1 && Math.abs(box.top - allocated.top) < 1
                    && Math.abs(box.width - allocated.width) < 1 && Math.abs(box.height - allocated.height) < 1, `${region}: retained host follows slot geometry`);
                check(frame.parentElement === parent && host.parentElement === hostParent && frame.contentDocument === originalDocument
                    && draft.value === 'Preserved across docking', `${region}: iframe parent, document and edited state survive`);
                check(document.activeElement === frame && originalDocument.activeElement === draft, `${region}: focused iframe input stays focused`);
            }
            const four = new Map(leaves.map((leaf, index) => [paneSurfaceKey(leaf), PANE_REGIONS[index]]));
            await change(() => { setAssignments(four); setHidden(new Set()); });
            check(preview.current!.querySelectorAll('[data-pane-surface]').length === 4, 'Four regions share one retained four-pane inventory');
            const areas = new Map(PANE_REGIONS.map(region => [region, preview.current!.querySelector<HTMLElement>(`[data-pane-region="${region}"]`)!.getBoundingClientRect()]));
            check(areas.get('primary-sidebar')!.right <= areas.get('workspace')!.left + 1
                && areas.get('secondary-sidebar')!.left >= areas.get('workspace')!.right - 1
                && areas.get('bottom-panel')!.top >= areas.get('workspace')!.bottom - 1, 'Primary, secondary and bottom areas do not overlap center');
            const sash = (label: string) => preview.current!.querySelector<HTMLElement>(`[role="separator"][aria-label="Resize ${label}"]`)!;
            const press = (element: HTMLElement, key: string) => element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            const wheel = (element: HTMLElement, ctrlKey = false) => element.dispatchEvent(new WheelEvent('wheel', { deltaY: 20, bubbles: true, cancelable: true, ctrlKey }));
            const fraction = (name: PaneRegion, dimension: 'width' | 'height') => {
                const region = preview.current!.querySelector<HTMLElement>(`[data-pane-region="${name}"]`)!.getBoundingClientRect();
                const canvas = preview.current!.querySelector<HTMLElement>('[data-probe-canvas]')!.getBoundingClientRect();
                return region[dimension] / canvas[dimension];
            };
            check(preview.current!.querySelectorAll('[role="separator"]').length === 3, 'Only occupied peripheral regions expose resize handles');
            for (const [label, region, key, dimension, expected] of [
                ['primary sidebar', 'primary-sidebar', 'ArrowRight', 'width', 0.29],
                ['secondary sidebar', 'secondary-sidebar', 'ArrowLeft', 'width', 0.29],
                ['bottom panel', 'bottom-panel', 'ArrowUp', 'height', 0.37],
            ] as const) {
                const handle = sash(label); handle.focus(); const before = resizeSaves.current;
                await change(() => press(handle, key));
                check(Math.abs(fraction(region, dimension) - expected) < 0.003 && resizeSaves.current === before + 1,
                    `${region}: keyboard resize updates real geometry and commits once`);
                check(document.activeElement === handle && handle.getAttribute('aria-valuetext') === `${Math.round(expected * 100)}% ${dimension}`,
                    `${region}: focused separator exposes its region size`);
                await change(() => press(handle, 'Enter'));
                check(Math.abs(fraction(region, dimension) - PANE_REGION_SIZE_RULES[region].initial) < 0.003,
                    `${region}: reset uses that region's default size`);
            }
            const left = sash('primary sidebar'); const beforeWheel = resizeSaves.current;
            wheel(left); wheel(left);
            check(resizeSaves.current === beforeWheel, 'Wheel burst does not synchronously persist each event');
            await settle();
            // Hidden browser tabs can delay animation frames beyond the wheel
            // settle timer. Geometry must be correct on either side of that timer.
            check(fraction('primary-sidebar', 'width') > 0.24, 'Wheel burst updates real region geometry');
            await new Promise(resolve => setTimeout(resolve, 180)); await settle();
            check(resizeSaves.current === beforeWheel + 1, 'Wheel burst persists only once after settling');
            await change(() => press(left, 'Enter'));
            const beforeCancel = resizeSaves.current;
            await change(() => { wheel(left); press(left, 'Escape'); });
            await new Promise(resolve => setTimeout(resolve, 180));
            check(resizeSaves.current === beforeCancel && Math.abs(fraction('primary-sidebar', 'width') - 0.24) < 0.003,
                'Escape before preview paint restores geometry and cancels the pending save');
            await change(() => press(left, 'ArrowRight'));
            check(Math.abs(fraction('primary-sidebar', 'width') - 0.29) < 0.003, 'Next input starts from the canceled gesture origin');
            await change(() => press(left, 'Enter'));
            refuseResize.current = true;
            await change(() => press(left, 'ArrowRight'));
            check(Math.abs(fraction('primary-sidebar', 'width') - 0.24) < 0.003, 'Refused save discards the draft geometry');
            refuseResize.current = false;
            await change(() => press(left, 'ArrowRight'));
            check(Math.abs(fraction('primary-sidebar', 'width') - 0.29) < 0.003, 'Next input after refusal starts from the saved size');
            await change(() => press(left, 'Enter'));
            const beforeBlur = resizeSaves.current;
            await change(() => { wheel(left); window.dispatchEvent(new Event('blur')); });
            await new Promise(resolve => setTimeout(resolve, 180));
            check(resizeSaves.current === beforeBlur && Math.abs(fraction('primary-sidebar', 'width') - 0.24) < 0.003,
                'Window blur cancels pending resize without saving');
            check(frame.contentDocument === originalDocument && frame.parentElement === parent && host.parentElement === hostParent
                && draft.value === 'Preserved across docking' && counts.loads.get(pluginKey) === initialLoads,
                'Interactive resizing preserves the same iframe, document, draft and host parent');
            for (const testWidth of [360, 900]) {
                await change(() => { setWidth(testWidth); setSizes({ primary: 0.35, secondary: 0.35, bottom: 0.5 }); });
                const canvasBox = preview.current!.querySelector<HTMLElement>('[data-probe-canvas]')!.getBoundingClientRect();
                check(Array.from(preview.current!.querySelectorAll<HTMLElement>('[data-pane-surface]')).every(element => {
                    const box = element.getBoundingClientRect();
                    return box.width > 0 && box.height > 0 && box.left >= canvasBox.left - 1 && box.right <= canvasBox.right + 1
                        && box.top >= canvasBox.top - 1 && box.bottom <= canvasBox.bottom + 1;
                }), `${testWidth}px: resized hosts remain inside canvas with positive dimensions`);
                checkNavigationGeometry([{ owner: 'primary', layout: canonical }], four, 'primary',
                    { primary: 0.35, secondary: 0.35, bottom: 0.5 }, `${testWidth}px`);
            }
            await change(() => setHidden(new Set([pluginKey])));
            check(host.inert && host.getBoundingClientRect().width === 0 && frame.contentDocument === originalDocument, 'Hidden dock retains its browsing context but is inert and unallocated');
            // The shell owns focus recovery on hide. Verify that an inert host cannot
            // acquire focus from an outside control, not that it performs that recovery.
            themeControl.current!.focus(); frame.focus();
            check(document.activeElement === themeControl.current, 'Hidden dock cannot take programmatic focus');
            await change(() => setHidden(new Set(leaves.map(paneSurfaceKey))));
            check(preview.current!.textContent?.includes('recovery area') && preview.current!.querySelectorAll('[data-pane-surface]').length === 4,
                'All-hidden keeps visited resources and center recovery without opening a replacement');
            await change(() => setHidden(new Set()));
            await change(() => setVisible(false));
            check(Array.from(preview.current!.querySelectorAll<HTMLElement>('[data-pane-surface]')).every(element => element.inert), 'Inactive canvas makes every region inert');
            await change(() => setVisible(true));
            check(counts.loads.get(pluginKey) === initialLoads && counts.mounts.get(pluginKey) === initialMounts
                && frame.contentDocument === originalDocument && draft.value === 'Preserved across docking', 'Move, resize, hide and reactivate do not remount or reload the plugin');
            await change(() => {
                setCrossCanvas(true); setActiveCanvas('first');
                setAssignments(new Map([[pluginKey, 'bottom-panel'], [paneSurfaceKey(leaves[1]), 'primary-sidebar']]));
            });
            draft.focus();
            for (const owner of ['second', 'first', 'second']) {
                await change(() => setActiveCanvas(owner));
                check(frame.contentDocument === originalDocument && frame.parentElement === parent && host.parentElement === hostParent
                    && draft.value === 'Preserved across docking', `${owner}: center switching keeps the dock's browsing context and draft`);
                const slot = Array.from(preview.current!.querySelectorAll<HTMLElement>('[data-region-slot]'))
                    .find(element => element.dataset.regionSlot === pluginKey)!;
                check(slot.closest('[data-pane-region]')?.getAttribute('data-pane-region') === 'bottom-panel'
                    && host.getBoundingClientRect().width > 0 && !host.inert, `${owner}: dock stays allocated while another canvas is selected`);
                check(document.activeElement === frame && originalDocument.activeElement === draft, `${owner}: selected dock input retains focus across center switches`);
            }
            check(counts.loads.get(pluginKey) === initialLoads && counts.mounts.get(pluginKey) === initialMounts,
                'Cross-canvas dock projection neither reloads nor remounts the resource');
            await change(() => setAssignments(new Map([[pluginKey, 'bottom-panel'], [paneSurfaceKey(leaves[1]), 'bottom-panel']])));
            const bottomSlots = Array.from(preview.current!.querySelectorAll<HTMLElement>('[data-pane-region="bottom-panel"] [data-region-slot]'));
            check(bottomSlots.length === 2 && bottomSlots.every(slot => slot.getBoundingClientRect().width > 0),
                'Two canonical canvases can share one dock region without replacing either resource');
            const firstBox = bottomSlots[0].getBoundingClientRect(); const secondBox = bottomSlots[1].getBoundingClientRect();
            check(firstBox.right <= secondBox.left + 1 && Math.abs(firstBox.width - secondBox.width) < 1,
                'Independent bottom allocations share equal non-overlapping geometry');
            checkNavigationGeometry(crossCanvases, new Map([[pluginKey, 'bottom-panel'], [paneSurfaceKey(leaves[1]), 'bottom-panel']]),
                'second', { primary: 0.35, secondary: 0.35, bottom: 0.5 }, 'Cross-canvas bottom pieces');
            check(frame.contentDocument === originalDocument && counts.loads.get(pluginKey) === initialLoads,
                'Regrouping dock allocations does not reload an existing iframe');
            await change(() => { setCrossCanvas(false); setAssignments(four); });
            const disposalBefore = counts.disposals.get(pluginKey) ?? 0;
            const otherFrame = preview.current!.querySelector<HTMLIFrameElement>('iframe[title="other-plugin"]')!;
            const otherDocument = otherFrame.contentDocument;
            await change(() => setLayout({ ...canonical, activePaneId: leaves[0].id, root: pair('remaining', leaves[0], pair('remaining-pair', leaves[1], leaves[3])) }));
            check(!frame.isConnected && counts.disposals.get(pluginKey) === disposalBefore + 1, 'Explicit removal disposes only the removed resource once');
            check(otherFrame.isConnected && otherFrame.contentDocument === otherDocument, 'Closing a docked sibling preserves the other plugin instance');
            setResult(`${results.join('\n')}\nALL ${results.length} CHECKS PASSED`);
        } catch (error) { setResult(`${results.join('\n')}\nFAIL ${String(error)}`); }
        finally {
            setRunning(false);
            // Keep a usable interactive preview after a run; the closed probe is deliberately reopened only by this fixture reset.
            setLayout(canonical); setHidden(new Set()); setWidth(undefined); setSizes({}); setCrossCanvas(false);
        }
    };
    return <main className="overlay-gallery space-y-4">
        <h1>Pane docking lifecycle prototype</h1>
        <p>Geometry and retained-host test only. No desktop sessions, saved layout or plugin permissions are changed.</p>
        <div className="flex flex-wrap gap-2">
            <Button onClick={() => { void run(); }} disabled={running}>Run docking checks</Button>
            <Button ref={themeControl} variant="secondary" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Use {theme === 'dark' ? 'light' : 'dark'} theme</Button>
            {PANE_REGIONS.map(region => <Button key={region} variant="secondary" disabled={running} onClick={() => move(region)}>Move plugin: {region}</Button>)}
            <Button variant="secondary" disabled={running} onClick={() => setHidden(new Set())}>Reveal all probes</Button>
            <Button variant="secondary" disabled={running} onClick={() => {
                if (getTabDockLive()) stopTabDock(); else startTabDock(paneDockPayload(leaves[2]), 'region-fixture');
            }}>Toggle drop guide preview</Button>
        </div>
        <pre aria-live="polite" className="whitespace-pre-wrap text-xs">{result}</pre>
        <div ref={preview} className="max-w-full border border-app-border" style={{ width, height: 384 }}>
            <Canvas key={scenario} layout={layout} assignments={assignments} hidden={hidden} visible={visible} sizes={sizes}
                crossCanvas={crossCanvas} activeCanvas={activeCanvas} onResize={resize}
                onDrop={(contentId, region) => setAssignments(previous => {
                    const moved = movePaneRegion(layout, previous, contentId, region, PANE_REGIONS);
                    return moved.ok ? moved.assignments : previous;
                })} />
        </div>
    </main>;
}

createRoot(document.getElementById('root')!).render(<Gallery />);
