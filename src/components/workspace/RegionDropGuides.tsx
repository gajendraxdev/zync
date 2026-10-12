import { paneRegionBounds, type PaneRegion, type PaneRegionSizes } from '../../lib/paneLayout/regions';
import { regionDropPresentation } from '../layout/tabDock/dropPresentation';

/** Geometry-only guides explicitly describe persistent docking, not a pane-edge split. */
export function RegionDropGuides({ destinations, occupied, sizes }: {
    destinations: readonly PaneRegion[]; occupied: ReadonlySet<PaneRegion>; sizes?: Partial<PaneRegionSizes>;
}) {
    return <div className="workspace-drop-guides absolute inset-0 z-50 pointer-events-none" aria-hidden>
        {destinations.map(region => {
            const box = paneRegionBounds(new Set([...occupied, region]), sizes)[region];
            const description = regionDropPresentation(region);
            return <div key={region} data-workspace-drop-preview="" className="absolute flex items-center justify-center"
                style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}>
                <div data-workspace-drop-region={region}
                    className="mx-2 max-w-44 rounded-md bg-app-panel/60 px-3 py-2 text-center text-xs font-medium text-app-text">
                    <span className="block">{description.title}</span>
                    <span className="block mt-1 text-[10px] text-app-muted">{description.detail}</span>
                </div>
            </div>;
        })}
    </div>;
}
