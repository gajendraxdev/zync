import { paneContentKey } from '../../../lib/paneLayout/contentIdentity';
import { collectPaneRects, neighborRectId, type PaneNavDirection, type PaneRect } from '../../../lib/paneLayout/nav';
import { paneRegionBounds, PANE_REGIONS, type PaneRegionSizes } from '../../../lib/paneLayout/regions';
import type { WorkspaceDockingProjection } from './dockingProjection';

/**
 * Match the region frame's normalized allocation and equal canonical pieces.
 * Geometry has no DOM/resource dependency and identities are content keys, so
 * navigation remains unambiguous when local pane IDs repeat across canvases.
 */
export function workspaceDockingRects(projection: WorkspaceDockingProjection, sizes?: Partial<PaneRegionSizes>): PaneRect[] {
    const bounds = paneRegionBounds(new Set(PANE_REGIONS.filter(region => projection.regions[region].length > 0)), sizes);
    return PANE_REGIONS.flatMap(region => {
        const pieces = projection.regions[region]; const rect = bounds[region];
        return pieces.flatMap(({ layout }, index) => collectPaneRects(layout.root,
            region === 'bottom-panel'
                ? { ...rect, x: rect.x + index * rect.w / pieces.length, w: rect.w / pieces.length }
                : { ...rect, y: rect.y + index * rect.h / pieces.length, h: rect.h / pieces.length },
            leaf => paneContentKey(leaf.content, leaf.id)));
    });
}

/** A boundary has no neighbor: do not wrap focus into a hidden or inactive canvas. */
export function neighborWorkspaceContentId(projection: WorkspaceDockingProjection, direction: PaneNavDirection,
    sizes?: Partial<PaneRegionSizes>): string | null {
    return projection.focusedContentId
        ? neighborRectId(workspaceDockingRects(projection, sizes), projection.focusedContentId, direction) : null;
}
