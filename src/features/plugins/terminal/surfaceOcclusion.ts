import type { TerminalSurfaceRect } from './surfaceGeometry';

/** Bound complexity before deriving any CSS from untrusted plugin geometry. */
export const MAX_TERMINAL_OVERLAYS = 8;
export const TERMINAL_HEADER_HEIGHT = 32;

function intersection(a: TerminalSurfaceRect, b: TerminalSurfaceRect): TerminalSurfaceRect | null {
    const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);
    return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

/**
 * Cut popup rectangles out of a stable surface, including pointer hit testing.
 * Only actual popup bounds are occluded, including over the header. Approval
 * remains in the separate host dialog; clipping never changes PTY geometry.
 */
export function terminalOcclusion(clip: TerminalSurfaceRect, overlays: readonly TerminalSurfaceRect[]): { hidden: boolean; clipPath?: string } {
    const holes = overlays.map(rect => intersection(clip, rect)).filter((rect): rect is TerminalSurfaceRect => rect !== null);
    if (!holes.length) return { hidden: false };
    // Subtract sequentially to handle overlapping popups without even-odd holes
    // cancelling each other. Eight axis-aligned rectangles keep this bounded.
    let regions = [clip];
    for (const hole of holes) {
        regions = regions.flatMap(region => {
            const cut = intersection(region, hole);
            if (!cut) return [region];
            return [
                { x: region.x, y: region.y, width: region.width, height: cut.y - region.y },
                { x: region.x, y: cut.y + cut.height, width: region.width, height: region.y + region.height - cut.y - cut.height },
                { x: region.x, y: cut.y, width: cut.x - region.x, height: cut.height },
                { x: cut.x + cut.width, y: cut.y, width: region.x + region.width - cut.x - cut.width, height: cut.height },
            ].filter(rect => rect.width > 0 && rect.height > 0);
        });
    }
    const path = regions.map(rect => {
        const x = rect.x - clip.x, y = rect.y - clip.y;
        return `M${x} ${y}h${rect.width}v${rect.height}h${-rect.width}Z`;
    }).join(' ');
    return { hidden: !regions.length, clipPath: `path('${path}')` };
}
