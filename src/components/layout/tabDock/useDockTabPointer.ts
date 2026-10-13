import { useRef } from 'react';
import type { DockPayload } from '../../../lib/paneLayout';
import { dockTargetFromPointer, type DockTarget } from './hit';
import { getTabDockLive, patchTabDockTarget, startTabDock, stopTabDock } from './session';
import { readTabContents } from './tabReorder';
import { useTabDragPointer } from '../tabDrag/useTabDragPointer';
import { createTabDragPreview } from '../tabDrag/preview';
import { createTabInsertionFeedback, createTabReorderFeedback, isOverTabStrip, isOverTabInsertionSurface, scrollTabStrip, tabInsertionTarget, tabReorderTarget } from '../tabDrag/reorder';
import type { DragPoint } from '../tabDrag/types';
import type { PaneTabInsertion, PaneTabReleaseSource } from '../../../features/workspace/domain/paneTabRelease';

export type DockTabPointerHandlers = {
    contextId: string;
    isEnabled: () => boolean;
    getSurface: () => HTMLElement | null;
    onDragStart: (payload: DockPayload) => void;
    onDragEnd: (payload: DockPayload, target: DockTarget | null) => void;
    onDragCancel: () => void;
    onTabReorder?: (source: readonly string[], target: readonly string[], after: boolean) => boolean;
    /** The active host's strip only; header drops share the existing unsplit contract. */
    getTabStrip?: () => HTMLElement | null;
    getPaneTabSource?: (payload: DockPayload) => PaneTabReleaseSource | null;
    canDropPaneTab?: (insertion: PaneTabInsertion) => boolean;
    onPaneTabDrop?: (insertion: PaneTabInsertion) => boolean;
};

/** Pane adapter: shared gestures own chrome; this adapter owns docking eligibility. */
export function useDockTabPointer(handlers: DockTabPointerHandlers | undefined) {
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;
    return useTabDragPointer<DockPayload>((target, payload, originPoint) => {
        const origin = handlersRef.current;
        if (!origin?.isEnabled()) return null;
        const surface = origin.getSurface();
        const source = origin.onTabReorder ? target.closest('[data-workspace-tab-contents]') : null;
        const ids = readTabContents(source);
        const sourceAxis = source?.closest('[data-tab-drag-strip]')?.getAttribute('data-tab-drag-axis');
        if (source && !ids) return null;
        const releaseCandidate = !source ? origin.getPaneTabSource?.(payload) : null;
        const releaseStrip = releaseCandidate ? origin.getTabStrip?.() : null;
        const release = releaseStrip ? releaseCandidate : null;
        const releaseAxis = releaseStrip?.getAttribute('data-tab-drag-axis');
        const token = Symbol('pane dock');
        let ownsDock = false;
        let began = false;
        let preview: ReturnType<typeof createTabDragPreview> = null;
        let sorting: ReturnType<typeof createTabReorderFeedback> = null;
        let insertionFeedback: ReturnType<typeof createTabInsertionFeedback> | null = null;
        let lastTarget: DockTarget | null = null;
        const current = () => {
            const value = handlersRef.current;
            return value?.contextId === origin.contextId && value.isEnabled() && value.getSurface() === surface
                && (!source || (source.isConnected && JSON.stringify(readTabContents(source)) === JSON.stringify(ids)
                    && source.closest('[data-tab-drag-strip]')?.getAttribute('data-tab-drag-axis') === sourceAxis))
                && (!release || (JSON.stringify(value.getPaneTabSource?.(payload)) === JSON.stringify(release)
                    && releaseStrip?.isConnected && value.getTabStrip?.() === releaseStrip
                    && releaseStrip.getAttribute('data-tab-drag-axis') === releaseAxis))
                ? value : undefined;
        };
        const hit = (point: DragPoint) => surface ? dockTargetFromPointer(point.x, point.y, surface) : null;
        const tabDrop = (point: DragPoint) => {
            if (!release || !releaseStrip) return null;
            const target = tabInsertionTarget(releaseStrip, point);
            const targetIds = readTabContents(target?.element ?? null);
            if (!target || !targetIds) return null;
            const insertion = { source: release, target: targetIds, after: target.after };
            return current()?.canDropPaneTab?.(insertion) ? { target, insertion } : null;
        };
        return {
            isValid: () => !!current() && (!ownsDock || getTabDockLive()?.owner === token),
            start: () => {
                if (getTabDockLive()) return false;
                began = true;
                ownsDock = true;
                surface?.setAttribute('data-pane-docking', 'true');
                startTabDock(payload, origin.contextId, token);
                preview = createTabDragPreview(target, originPoint);
                sorting = source ? createTabReorderFeedback(source) : null;
                insertionFeedback = releaseStrip ? createTabInsertionFeedback(releaseStrip) : null;
                origin.onDragStart(payload);
            },
            move: (point) => {
                const scrolling = source ? scrollTabStrip(source, point) : releaseStrip ? scrollTabStrip(releaseStrip, point) : false;
                const overStrip = source ? isOverTabStrip(source, point) : !!releaseStrip && isOverTabInsertionSurface(releaseStrip, point);
                if (overStrip) surface?.setAttribute('data-pane-docking-strip', 'true');
                else surface?.removeAttribute('data-pane-docking-strip');
                const reorder = source ? tabReorderTarget(source, point) : null;
                sorting?.update(reorder);
                insertionFeedback?.update(tabDrop(point)?.target ?? null);
                preview?.move(point);
                lastTarget = reorder || overStrip ? null : hit(point);
                patchTabDockTarget(lastTarget);
                return scrolling;
            },
            resolveDrop: (point) => {
                surface?.removeAttribute('data-pane-docking-strip');
                // A strip miss/refusal must not fall through to a pane-edge split.
                if (releaseStrip && isOverTabInsertionSurface(releaseStrip, point)) {
                    const drop = tabDrop(point);
                    return drop ? () => current()?.onPaneTabDrop?.(drop.insertion) ?? false : null;
                }
                const reorder = source ? tabReorderTarget(source, point) : null;
                const destination = hit(point);
                if (lastTarget?.kind === 'region' && (destination?.kind !== 'region' || destination.region !== lastTarget.region)) return null;
                if (source && isOverTabStrip(source, point)) {
                    const targetIds = readTabContents(reorder?.element ?? null);
                    if (!reorder || !targetIds || !ids) return null;
                    return () => current()?.onTabReorder?.(ids, targetIds, reorder.after) ?? false;
                }
                return () => {
                    const live = current();
                    if (!live) return false;
                    live.onDragEnd(payload, destination);
                    return true;
                };
            },
            cancel: () => { if (began) origin.onDragCancel(); },
            dispose: () => {
                preview?.dispose();
                sorting?.dispose();
                insertionFeedback?.dispose();
                if (ownsDock && getTabDockLive()?.owner === token) {
                    surface?.removeAttribute('data-pane-docking');
                    surface?.removeAttribute('data-pane-docking-strip');
                    stopTabDock();
                }
                ownsDock = false;
            },
        };
    });
}
