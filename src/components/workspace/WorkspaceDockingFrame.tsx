import type { ReactNode } from 'react';
import type { DockingAllocation, WorkspaceDockingProjection } from '../../features/workspace/domain/dockingProjection';
import { PANE_REGIONS, type PaneRegion, type PaneRegionSizes } from '../../lib/paneLayout/regions';
import { PaneRegionFrame } from './PaneRegionFrame';
import { ResizablePaneRegionFrame } from './ResizablePaneRegionFrame';
import type { DockedPaneRegion } from '../../features/workspace/domain/docking';

/**
 * Disposable geometry for a connection's docks and selected center. Multiple
 * canonical pieces share a region equally without inventing persisted split IDs.
 * The renderer keeps each piece's own dividers, identities and ratios. All content
 * hosts must remain in the sibling retained layer, never beneath these cells.
 */
export function WorkspaceDockingFrame({ projection, sizes, renderAllocation, emptyWorkspace, onResize, onResizeRefused }: {
    projection: WorkspaceDockingProjection;
    sizes?: Partial<PaneRegionSizes>;
    renderAllocation: (allocation: DockingAllocation, region: PaneRegion) => ReactNode;
    emptyWorkspace?: ReactNode;
    onResize?: (region: DockedPaneRegion, size: number) => boolean;
    onResizeRefused?: () => void;
}) {
    const occupied = new Set(PANE_REGIONS.filter(region => projection.regions[region].length > 0));
    const renderRegion = (region: PaneRegion) => {
        const allocations = projection.regions[region];
        if (!allocations.length) return region === 'workspace' ? emptyWorkspace : null;
        const tracks = `repeat(${allocations.length}, minmax(0, 1fr))`;
        return <div className="grid h-full min-w-0 min-h-0" style={region === 'bottom-panel'
            ? { gridTemplateColumns: tracks } : { gridTemplateRows: tracks }}>
            {allocations.map(allocation => <div key={allocation.owner} data-region-owner={allocation.owner}
                className="relative min-w-0 min-h-0 overflow-hidden">
                {renderAllocation(allocation, region)}
            </div>)}
        </div>;
    };
    return onResize ? <ResizablePaneRegionFrame regions={occupied} sizes={sizes} renderRegion={renderRegion}
        onResize={onResize} onResizeRefused={onResizeRefused} />
        : <PaneRegionFrame regions={occupied} sizes={sizes} renderRegion={renderRegion} />;
}
