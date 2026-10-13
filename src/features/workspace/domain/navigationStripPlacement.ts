import type { WorkspaceTabsPosition } from './navigation';

/** Only explicit shell edges accept a whole-strip drop. Pane drop targets are unrelated. */
export function navigationStripDropTarget(point: { x: number; y: number },
    bounds: { left: number; right: number; top: number; bottom: number }): WorkspaceTabsPosition | null {
    if (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom) return null;
    const edge = Math.min(48, (bounds.right - bounds.left) / 4);
    if (point.x <= bounds.left + edge) return 'left';
    if (point.x >= bounds.right - edge) return 'right';
    return point.y <= bounds.top + 40 ? 'default' : null;
}
