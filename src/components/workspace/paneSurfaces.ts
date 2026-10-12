import { isPaneLeaf, type PaneLayout, type PaneLeaf, type PaneNode } from '../../lib/paneLayout';
import { paneContentKey } from '../../lib/paneLayout/contentIdentity';

export interface InternalEdges {
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
}

export interface PaneSurface {
    key: string;
    node: PaneLeaf;
    /** Canonical resource topology, never the pruned geometry projection. */
    layout: PaneLayout;
    /** Effective visible focus may differ while the saved focused leaf is hidden. */
    focusedPaneId?: string;
    /** Connection-wide allocation can override local canvas focus without ambiguous IDs. */
    focused?: boolean;
    edges: InternalEdges;
    split: boolean;
    visible: boolean;
}

/** Compatibility entry point for geometry callers; identity lives in the layout domain. */
export function paneSurfaceKey(node: PaneLeaf): string {
    return paneContentKey(node.content, node.id);
}

export function layoutSurfaces(layout: PaneLayout, visible: boolean): PaneSurface[] {
    const result: PaneSurface[] = [];
    const split = !isPaneLeaf(layout.root);
    const visit = (node: PaneNode, edges: InternalEdges) => {
        if (isPaneLeaf(node)) {
            result.push({ key: paneSurfaceKey(node), node, layout, edges, split, visible });
            return;
        }
        const stacked = node.direction === 'vertical';
        visit(node.children[0], stacked ? { ...edges, bottom: true } : { ...edges, right: true });
        visit(node.children[1], stacked ? { ...edges, top: true } : { ...edges, left: true });
    };
    visit(layout.root, {});
    return result;
}

/**
 * Allocate visible geometry while retaining every canonical content identity.
 * Hidden/unselected content stays in the surface inventory with visibility off;
 * only the projection supplies visible edges, split chrome and effective focus.
 */
export function projectedLayoutSurfaces(
    canonical: PaneLayout,
    projected: PaneLayout | null,
    visible: boolean,
): PaneSurface[] {
    const surfaces = layoutSurfaces(canonical, false);
    if (!visible || !projected) return surfaces;
    const shown = new Map(layoutSurfaces(projected, true).map(surface => [surface.key, surface]));
    return surfaces.map(surface => {
        const allocation = shown.get(surface.key);
        return allocation ? { ...allocation, layout: canonical, focusedPaneId: projected.activePaneId } : surface;
    });
}

/** Retain visited live content, not its former owner. */
export function retainPaneSurfaces(surfaces: readonly PaneSurface[], visited: ReadonlySet<string>): PaneSurface[] {
    const unique = new Map<string, PaneSurface>();
    for (const surface of surfaces) {
        if (!visited.has(surface.key) && !surface.visible) continue;
        const previous = unique.get(surface.key);
        if (!previous || surface.visible) unique.set(surface.key, surface);
    }
    // Even moving an existing iframe ancestor with appendChild reloads its document.
    // Keep surviving hosts in mount order; newly visited content is appended.
    const ordered: PaneSurface[] = [];
    for (const key of visited) {
        const surface = unique.get(key);
        if (surface) ordered.push(surface);
    }
    for (const [key, surface] of unique) {
        if (!visited.has(key)) ordered.push(surface);
    }
    return ordered;
}
