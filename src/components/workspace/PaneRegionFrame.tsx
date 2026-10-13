import type { ReactNode } from 'react';
import { normalizePaneRegionSizes, PANE_REGIONS, type PaneRegion, type PaneRegionSizes } from '../../lib/paneLayout/regions';

/**
 * Allocate geometry slots only. Live content belongs in the sibling flat retained
 * surface layer, never inside these replaceable cells. The center stays available
 * for recovery when every pane has moved or been hidden. No app/feature ownership.
 */
export function PaneRegionFrame({ regions, sizes, renderRegion, children }: {
    regions: ReadonlySet<PaneRegion>;
    sizes?: Partial<PaneRegionSizes>;
    renderRegion: (region: PaneRegion) => ReactNode;
    /** Geometry-only controls; retained content must remain a sibling of this frame. */
    children?: ReactNode;
}) {
    const safeSizes = normalizePaneRegionSizes(sizes);
    const primary = regions.has('primary-sidebar') ? safeSizes.primary * 100 : 0;
    const secondary = regions.has('secondary-sidebar') ? safeSizes.secondary * 100 : 0;
    const bottom = regions.has('bottom-panel') ? safeSizes.bottom * 100 : 0;
    return <div data-pane-region-frame="" className="absolute inset-0 grid min-w-0 min-h-0 overflow-hidden"
        style={{ gridTemplateColumns: `${primary}% minmax(0, 1fr) ${secondary}%`,
            gridTemplateRows: `minmax(0, 1fr) ${bottom}%` }}>
        {PANE_REGIONS.map(region => <div key={region} data-pane-region={region}
            className="relative min-w-0 min-h-0 overflow-hidden"
            style={{ display: region === 'workspace' || regions.has(region) ? undefined : 'none',
                gridColumn: region === 'primary-sidebar' ? 1 : region === 'secondary-sidebar' ? 3 : 2,
                gridRow: region === 'bottom-panel' ? 2 : region === 'workspace' ? 1 : '1 / 3' }}>
            {renderRegion(region)}
        </div>)}
        {children}
    </div>;
}
