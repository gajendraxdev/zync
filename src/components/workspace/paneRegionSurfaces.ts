import type { PaneLayout } from '../../lib/paneLayout/types';
import { PANE_REGIONS, type PaneRegionLayouts } from '../../lib/paneLayout/regions';
import { layoutSurfaces, type PaneSurface } from './paneSurfaces';

/**
 * Project disjoint region geometry onto one canonical retained host inventory.
 * Only one pane owns visible focus across all regions. Per-region fallbacks must
 * not accidentally focus a terminal in each region at the same time.
 */
export function paneRegionSurfaces(canonical: PaneLayout, regions: PaneRegionLayouts, visible: boolean): PaneSurface[] {
    const surfaces = layoutSurfaces(canonical, false);
    if (!visible) return surfaces;
    const allocations = PANE_REGIONS.flatMap(region => {
        const layout = regions[region];
        return layout ? layoutSurfaces(layout, true) : [];
    });
    const focusedPaneId = allocations.find(surface => surface.node.id === canonical.activePaneId)?.node.id
        ?? allocations[0]?.node.id;
    const shown = new Map(allocations.map(surface => [surface.key, surface]));
    return surfaces.map(surface => {
        const allocation = shown.get(surface.key);
        return allocation ? { ...allocation, layout: canonical, focusedPaneId } : surface;
    });
}
