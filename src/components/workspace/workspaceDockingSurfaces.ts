import type { WorkspaceCanvas } from '../../features/workspace/domain/canvases';
import type { WorkspaceDockingProjection } from '../../features/workspace/domain/dockingProjection';
import { PANE_REGIONS } from '../../lib/paneLayout/regions';
import { layoutSurfaces, type PaneSurface } from './paneSurfaces';

/**
 * Join connection-wide geometry onto the existing canonical retained inventory.
 * Hidden and inactive resources remain in that inventory, never in a second host
 * layer. Explicit content-key focus gives exactly one visible pane input ownership,
 * even when two canonical canvases contain the same local pane ID.
 */
export function workspaceDockingSurfaces(
    canvases: readonly WorkspaceCanvas[], projection: WorkspaceDockingProjection, visible: boolean,
): PaneSurface[] {
    const allocations = new Map(PANE_REGIONS.flatMap(region => projection.regions[region].flatMap(({ layout }) =>
        layoutSurfaces(layout, true).map(surface => [surface.key, surface] as const))));
    const multipleVisible = allocations.size > 1;
    return canvases.flatMap(({ layout: canonical }) => layoutSurfaces(canonical, false).map(surface => {
        const allocation = visible ? allocations.get(surface.key) : undefined;
        return allocation ? {
            ...allocation, layout: canonical, split: multipleVisible || projection.maximizedContentId === surface.key,
            focused: surface.key === projection.focusedContentId,
        } : { ...surface, focused: false };
    }));
}
