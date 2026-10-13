import { useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../store/useAppStore';
import { workspaceRegionDropContent } from '../../features/workspace/application/regionDrop';
import type { WorkspaceDockingProjection } from '../../features/workspace/domain/dockingProjection';
import { PANE_REGIONS, type PaneRegionSizes } from '../../lib/paneLayout/regions';
import { getTabDockLive, subscribeTabDock } from '../layout/tabDock/session';
import { collectLeaves, paneContentKey } from '../../lib/paneLayout';
import { RegionDropGuides } from './RegionDropGuides';

/** A drag is bound to one tab context; pointer-target updates do not re-render the guide layer. */
export function WorkspaceRegionDropTargets({ scope, contextId, projection, sizes }: {
    scope: string; contextId: string; projection: WorkspaceDockingProjection; sizes?: Partial<PaneRegionSizes>;
}) {
    const payload = useSyncExternalStore(subscribeTabDock, () => {
        const live = getTabDockLive();
        return live?.contextId === contextId ? live.payload : null;
    }, () => null);
    const state = useAppStore(useShallow(state => ({
        sessionLoaded: state.sessionLoaded, isRestoring: state.isRestoring,
        sessionPersistenceBlocked: state.sessionPersistenceBlocked, workspaceDocking: state.workspaceDocking,
        workspaceViewRegistry: state.workspaceViewRegistry, terminals: state.terminals,
        paneLayouts: state.paneLayouts, contentPresentation: state.contentPresentation,
    })));
    if (!payload) return null;
    const occupied = new Set(PANE_REGIONS.filter(region => projection.regions[region].length > 0));
    const destinations = PANE_REGIONS.filter(region => !occupied.has(region)
        && workspaceRegionDropContent(state, scope, payload, region) !== null);
    if (!destinations.length) return null;
    const contentId = workspaceRegionDropContent(state, scope, payload, destinations[0]);
    // The source's last visible allocation collapses on a move. Preview the
    // destination against the remaining regions, not stale pre-drop occupancy.
    const remaining = new Set(PANE_REGIONS.filter(region => projection.regions[region].some(allocation =>
        collectLeaves(allocation.layout.root).some(leaf => paneContentKey(leaf.content, leaf.id) !== contentId))));
    return <RegionDropGuides destinations={destinations} occupied={remaining} sizes={sizes} />;
}
