import { paneContentKey } from '../../../lib/paneLayout/contentIdentity';
import { collectLeaves } from '../../../lib/paneLayout/query';
import { PANE_REGIONS, projectPaneRegions, type PaneRegion, type PaneRegionAssignments } from '../../../lib/paneLayout/regions';
import type { PaneLayout } from '../../../lib/paneLayout/types';
import type { WorkspaceCanvas } from './canvases';
import { workspaceDockingCapacity, type DockingCapacity } from './docking';

/** One canonical tree's geometry in a region; its real split IDs remain resizable. */
export interface DockingAllocation {
    owner: string;
    canonical: PaneLayout;
    layout: PaneLayout;
}

export interface WorkspaceDockingProjection {
    regions: Readonly<Record<PaneRegion, readonly DockingAllocation[]>>;
    /** Stable content identity avoids collisions between pane IDs in different canvases. */
    focusedContentId: string | null;
    /** Transient presentation only; the canonical split trees are never replaced. */
    maximizedContentId?: string;
}

export interface MaximizedWorkspacePane {
    contentId: string;
    /** Switching the selected center also restores a maximized dock. */
    selectedOwner: string | null;
}

/**
 * Expand one currently focused, visible identity into the center allocation.
 * Stale selection/focus/visibility restores normal geometry immediately. Resource
 * inventory, canonical trees, dock placements and saved ratios remain untouched.
 */
export function projectMaximizedWorkspacePane(projection: WorkspaceDockingProjection,
    request: MaximizedWorkspacePane | undefined, selectedOwner: string | null): WorkspaceDockingProjection {
    if (!request || request.selectedOwner !== selectedOwner || projection.focusedContentId !== request.contentId) return projection;
    for (const region of PANE_REGIONS) {
        for (const allocation of projection.regions[region]) {
            const leaf = collectLeaves(allocation.layout.root).find(pane => paneContentKey(pane.content, pane.id) === request.contentId);
            if (!leaf) continue;
            return {
                focusedContentId: request.contentId, maximizedContentId: request.contentId,
                regions: { workspace: [{ ...allocation, layout: { ...allocation.layout, root: leaf, activePaneId: leaf.id } }],
                    'primary-sidebar': [], 'secondary-sidebar': [], 'bottom-panel': [] },
            };
        }
    }
    return projection;
}

export type DockingProjectionResult =
    | { ok: true; value: WorkspaceDockingProjection }
    | Extract<DockingCapacity, { ok: false }>
    | { ok: false; reason: 'duplicate-owner' };

/**
 * Allocate the selected center canvas plus persistent docks from this connection.
 * No resource ownership, selection, saved split ratios or preferences are changed.
 * Distinct canonical pieces stay distinct: inventing a combined split tree would
 * give its dividers synthetic IDs that the resource-owning store cannot resize.
 * Invalid reservations produce no partial projection; the shell must offer recovery.
 */
export function projectWorkspaceDocking(
    canvases: readonly WorkspaceCanvas[], assignments: PaneRegionAssignments,
    hiddenContentIds: ReadonlySet<string>, selectedOwner: string | null,
    requestedFocus: string | null = null,
): DockingProjectionResult {
    if (new Set(canvases.map(canvas => canvas.owner)).size !== canvases.length) return { ok: false, reason: 'duplicate-owner' };
    const capacity = workspaceDockingCapacity(canvases.map(canvas => canvas.layout), assignments);
    if (!capacity.ok) return capacity;
    const regions: Record<PaneRegion, DockingAllocation[]> = {
        workspace: [], 'primary-sidebar': [], 'secondary-sidebar': [], 'bottom-panel': [],
    };
    for (const { owner, layout: canonical } of canvases) {
        const projected = projectPaneRegions(canonical, assignments, hiddenContentIds);
        for (const region of PANE_REGIONS) {
            const layout = projected[region];
            if (layout && (region !== 'workspace' || owner === selectedOwner)) regions[region].push({ owner, canonical, layout });
        }
    }
    const visibleKeys = new Set(PANE_REGIONS.flatMap(region => regions[region].flatMap(({ layout }) =>
        collectLeaves(layout.root).map(leaf => paneContentKey(leaf.content, leaf.id)))));
    const selected = canvases.find(canvas => canvas.owner === selectedOwner)?.layout;
    const selectedLeaf = selected && collectLeaves(selected.root).find(leaf => leaf.id === selected.activePaneId);
    const selectedKey = selectedLeaf ? paneContentKey(selectedLeaf.content, selectedLeaf.id) : null;
    const focusedContentId = requestedFocus && visibleKeys.has(requestedFocus) ? requestedFocus
        : selectedKey && visibleKeys.has(selectedKey) ? selectedKey
        : visibleKeys.values().next().value ?? null;
    return { ok: true, value: { regions, focusedContentId } };
}
