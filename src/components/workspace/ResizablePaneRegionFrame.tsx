import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { normalizePaneRegionSizes, PANE_REGION_SIZE_RULES, type PaneRegion, type PaneRegionSizes } from '../../lib/paneLayout/regions';
import type { DockedPaneRegion } from '../../features/workspace/domain/docking';
import { PaneDivider } from '../terminal/PaneDivider';
import { PaneRegionFrame } from './PaneRegionFrame';

const RESIZE_REGIONS = ['primary-sidebar', 'secondary-sidebar', 'bottom-panel'] as const;
const LABELS = { 'primary-sidebar': 'primary sidebar', 'secondary-sidebar': 'secondary sidebar', 'bottom-panel': 'bottom panel' };
type Draft = { region: DockedPaneRegion; size: number };

/**
 * Preview only allocation geometry, coalesced per frame; commit one addressed
 * fraction on release. The store merges that fraction into fresh saved metadata.
 * Cancellation, refusal and removal discard the preview without touching content.
 */
export function ResizablePaneRegionFrame({ regions, sizes, renderRegion, onResize, onResizeRefused }: {
    regions: ReadonlySet<PaneRegion>;
    sizes?: Partial<PaneRegionSizes>;
    renderRegion: (region: PaneRegion) => ReactNode;
    onResize: (region: DockedPaneRegion, size: number) => boolean;
    onResizeRefused?: () => void;
}) {
    const [preview, setPreview] = useState<Draft | null>(null);
    const pending = useRef<Draft | null>(null);
    const frame = useRef(0);
    const clearPreview = useCallback(() => {
        if (frame.current) cancelAnimationFrame(frame.current);
        frame.current = 0;
        pending.current = null;
        setPreview(null);
    }, []);
    useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
    const change = (region: DockedPaneRegion, coordinate: number) => {
        const rule = PANE_REGION_SIZE_RULES[region];
        const size = region === 'primary-sidebar' ? coordinate : 1 - coordinate;
        pending.current = { region, size: Math.max(rule.min, Math.min(rule.max, size)) };
        if (!frame.current) frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            setPreview(pending.current);
        });
    };
    const commit = (region: DockedPaneRegion) => {
        const draft = pending.current;
        if (draft?.region !== region) return false;
        clearPreview();
        if (!regions.has(draft.region)) return false;
        const accepted = onResize(draft.region, draft.size);
        if (!accepted) onResizeRefused?.();
        return accepted;
    };
    const current = normalizePaneRegionSizes(sizes);
    const displayed = preview && regions.has(preview.region)
        ? { ...current, [PANE_REGION_SIZE_RULES[preview.region].key]: preview.size } : current;
    return <PaneRegionFrame regions={regions} sizes={displayed} renderRegion={renderRegion}>
        {RESIZE_REGIONS.filter(region => regions.has(region)).map(region => {
            const rule = PANE_REGION_SIZE_RULES[region];
            const size = displayed[rule.key];
            const primary = region === 'primary-sidebar';
            const bottom = region === 'bottom-panel';
            return <PaneDivider key={region}
                frameSelector="[data-pane-region-frame]"
                direction={bottom ? 'vertical' : 'horizontal'}
                firstRatio={primary ? size : 1 - size}
                minRatio={primary ? rule.min : 1 - rule.max}
                maxRatio={primary ? rule.max : 1 - rule.min}
                label={`Resize ${LABELS[region]}`}
                title="Drag, scroll, or arrow keys to resize · double-click or Enter to reset size"
                valueText={`${Math.round(size * 100)}% ${bottom ? 'height' : 'width'}`}
                style={bottom ? { left: `${regions.has('primary-sidebar') ? displayed.primary * 100 : 0}%`,
                    right: `${regions.has('secondary-sidebar') ? displayed.secondary * 100 : 0}%` } : undefined}
                onDrag={coordinate => change(region, coordinate)}
                onDragEnd={() => commit(region)}
                onCancel={() => { if (pending.current?.region === region) clearPreview(); }}
                onEqualize={() => {
                    clearPreview();
                    if (!onResize(region, rule.initial)) onResizeRefused?.();
                }}
            />;
        })}
    </PaneRegionFrame>;
}
