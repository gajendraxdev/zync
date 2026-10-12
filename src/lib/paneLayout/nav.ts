import { focusPane } from './ops';
import { isPaneLeaf, isPaneSplit } from './query';
import type { PaneLayout, PaneLeaf, PaneNode } from './types';

export type PaneNavDirection = 'left' | 'right' | 'up' | 'down';

export type PaneRect = { id: string; x: number; y: number; w: number; h: number };

const EPS = 1e-6;

export function paneNavDirectionFromKey(key: string): PaneNavDirection | null {
    switch (key) {
        case 'ArrowLeft':
            return 'left';
        case 'ArrowRight':
            return 'right';
        case 'ArrowUp':
            return 'up';
        case 'ArrowDown':
            return 'down';
        default:
            return null;
    }
}

/** Project existing split ratios into an allocation; callers may supply global identities. */
export function collectPaneRects(node: PaneNode, bounds: Omit<PaneRect, 'id'>,
    identity: (leaf: PaneLeaf) => string = leaf => leaf.id): PaneRect[] {
    const { x, y, w, h } = bounds;
    if (isPaneLeaf(node)) {
        return [{ id: identity(node), x, y, w, h }];
    }
    const sum = node.sizes[0] + node.sizes[1];
    const first = sum > 0 ? node.sizes[0] / sum : 0.5;
    if (node.direction === 'horizontal') {
        const w0 = w * first;
        return [
            ...collectPaneRects(node.children[0], { x, y, w: w0, h }, identity),
            ...collectPaneRects(node.children[1], { x: x + w0, y, w: w - w0, h }, identity),
        ];
    }
    const h0 = h * first;
    return [
        ...collectPaneRects(node.children[0], { x, y, w, h: h0 }, identity),
        ...collectPaneRects(node.children[1], { x, y: y + h0, w, h: h - h0 }, identity),
    ];
}

function isBetter(overlap: number, gap: number, bestOverlap: number, bestGap: number): boolean {
    const band = overlap > 0 ? 0 : 1;
    const bestBand = bestOverlap > 0 ? 0 : 1;
    if (band !== bestBand) return band < bestBand;
    if (Math.abs(gap - bestGap) > EPS) return gap < bestGap;
    return overlap > bestOverlap;
}

export function neighborPaneId(layout: PaneLayout, direction: PaneNavDirection): string | null {
    if (!isPaneSplit(layout.root)) return null;
    return neighborRectId(collectPaneRects(layout.root, { x: 0, y: 0, w: 1, h: 1 }), layout.activePaneId, direction);
}

/** Shared spatial navigation for split trees and connection-wide region allocations. */
export function neighborRectId(rects: readonly PaneRect[], sourceId: string, direction: PaneNavDirection): string | null {
    const src = rects.find((rect) => rect.id === sourceId);
    if (!src) return null;

    let bestId: string | null = null;
    let bestOverlap = -1;
    let bestGap = Infinity;

    for (const rect of rects) {
        if (rect.id === src.id) continue;
        let gap = Infinity;
        let overlap = 0;
        if (direction === 'right') {
            if (rect.x + EPS < src.x + src.w) continue;
            gap = rect.x - (src.x + src.w);
            overlap = Math.max(0, Math.min(src.y + src.h, rect.y + rect.h) - Math.max(src.y, rect.y));
        } else if (direction === 'left') {
            if (rect.x + rect.w > src.x + EPS) continue;
            gap = src.x - (rect.x + rect.w);
            overlap = Math.max(0, Math.min(src.y + src.h, rect.y + rect.h) - Math.max(src.y, rect.y));
        } else if (direction === 'down') {
            if (rect.y + EPS < src.y + src.h) continue;
            gap = rect.y - (src.y + src.h);
            overlap = Math.max(0, Math.min(src.x + src.w, rect.x + rect.w) - Math.max(src.x, rect.x));
        } else {
            if (rect.y + rect.h > src.y + EPS) continue;
            gap = src.y - (rect.y + rect.h);
            overlap = Math.max(0, Math.min(src.x + src.w, rect.x + rect.w) - Math.max(src.x, rect.x));
        }
        if (!Number.isFinite(gap) || !isBetter(overlap, gap, bestOverlap, bestGap)) continue;
        bestId = rect.id;
        bestOverlap = overlap;
        bestGap = gap;
    }

    return bestId;
}

export function focusPaneInDirection(layout: PaneLayout, direction: PaneNavDirection): PaneLayout {
    const nextId = neighborPaneId(layout, direction);
    return nextId ? focusPane(layout, nextId) : layout;
}
