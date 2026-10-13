import {
    dockEdgeFromPoint,
    dockPreviewRect,
    isSplitFeatureId,
    paneBoxAtPoint,
    type DockEdge,
    type SplitFeatureId,
} from '../../../lib/paneLayout';
import { isPaneRegion, type PaneRegion } from '../../../lib/paneLayout/regions';

/** Full-view feature overlay; drop a shell here to split beside that feature. */
export function overlayPaneId(featureId: string): string {
    return `overlay:${featureId}`;
}

export function parseOverlayFeatureId(paneId: string | null | undefined): SplitFeatureId | null {
    if (!paneId || !paneId.startsWith('overlay:')) return null;
    const id = paneId.slice('overlay:'.length);
    if (id.startsWith('plugin:')) return null;
    return isSplitFeatureId(id) ? id : null;
}

export function overlayPluginPaneId(pluginId: string): string {
    return `overlay:plugin:${pluginId}`;
}

export function parseOverlayPluginId(paneId: string | null | undefined): string | null {
    if (!paneId || !paneId.startsWith('overlay:plugin:')) return null;
    const id = paneId.slice('overlay:plugin:'.length);
    return id || null;
}

/** Full-view Files overlay; drop a shell here to split beside Files. */
export const FILES_OVERLAY_PANE_ID = overlayPaneId('files');

type DropPreview = { left: number; top: number; width: number; height: number };
export type DockTarget = {
    kind: 'pane';
    paneId: string | null;
    contentId?: string;
    edge: DockEdge;
    preview: DropPreview;
} | { kind: 'region'; region: PaneRegion; preview: DropPreview };

/** Explicit guides take precedence; ordinary pane edges retain their split behavior elsewhere. */
function regionTargetAt(clientX: number, clientY: number, surface: HTMLElement, origin: DOMRect): DockTarget | null {
    for (const guide of surface.querySelectorAll<HTMLElement>('[data-workspace-drop-region]')) {
        const region = guide.dataset.workspaceDropRegion;
        if (!isPaneRegion(region) || !isDockPaneHitTestable(guide)) continue;
        const box = guide.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0 || clientX < box.left || clientX > box.right || clientY < box.top || clientY > box.bottom) continue;
        const preview = guide.closest<HTMLElement>('[data-workspace-drop-preview]')?.getBoundingClientRect();
        if (preview && preview.width > 0 && preview.height > 0) return { kind: 'region', region,
            preview: { left: preview.left - origin.left, top: preview.top - origin.top, width: preview.width, height: preview.height } };
    }
    return null;
}

function isDockPaneHitTestable(node: HTMLElement): boolean {
    if (node.closest('[hidden], [inert]')) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
}

function collectPaneBoxes(surface: HTMLElement, originLeft: number, originTop: number) {
    const boxes: Array<{ id: string; contentId?: string; x: number; y: number; w: number; h: number }> = [];
    for (const node of surface.querySelectorAll('[data-pane-id]')) {
        if (!(node instanceof HTMLElement)) continue;
        const id = node.dataset.paneId;
        if (!id) continue;
        if (!isDockPaneHitTestable(node)) continue;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        boxes.push({
            id,
            contentId: node.dataset.paneContentId,
            x: rect.left - originLeft,
            y: rect.top - originTop,
            w: rect.width,
            h: rect.height,
        });
    }
    return boxes;
}

/** Hit-test the pane under the pointer and the half-pane preview inside it. */
export function dockTargetFromPointer(
    clientX: number,
    clientY: number,
    surface: HTMLElement,
): DockTarget | null {
    const surfaceRect = surface.getBoundingClientRect();
    if (surfaceRect.width <= 0 || surfaceRect.height <= 0) return null;
    const localX = clientX - surfaceRect.left;
    const localY = clientY - surfaceRect.top;
    if (localX < 0 || localY < 0 || localX > surfaceRect.width || localY > surfaceRect.height) {
        return null;
    }

    const region = regionTargetAt(clientX, clientY, surface, surfaceRect);
    if (region) return region;
    const panes = collectPaneBoxes(surface, surfaceRect.left, surfaceRect.top);
    const hit = paneBoxAtPoint(localX, localY, panes);
    const pane = hit ?? {
        id: '',
        x: 0,
        y: 0,
        w: surfaceRect.width,
        h: surfaceRect.height,
    };
    const edge = dockEdgeFromPoint(localX - pane.x, localY - pane.y, pane.w, pane.h);
    if (!edge) return null;
    const preview = dockPreviewRect(pane, edge);
    return {
        kind: 'pane',
        paneId: pane.id || null,
        contentId: panes.find(box => box === hit)?.contentId,
        edge,
        preview: { left: preview.x, top: preview.y, width: preview.w, height: preview.h },
    };
}
