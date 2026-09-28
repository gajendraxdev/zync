import { isPaneLeaf, type PaneLayout, type PaneLeaf, type PaneNode } from '../../lib/paneLayout';

export interface InternalEdges {
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    left?: boolean;
}

export interface PaneSurface {
    key: string;
    node: PaneLeaf;
    layout: PaneLayout;
    edges: InternalEdges;
    split: boolean;
    visible: boolean;
}

/** Identity is independent of split paths, layout owners and leaf IDs. */
export function paneSurfaceKey(node: PaneLeaf): string {
    const content = node.content;
    if (content.kind === 'term') return JSON.stringify([content.kind, content.termId]);
    const reference = content.kind === 'feature' ? content.featureId : content.pluginId;
    return JSON.stringify([content.kind, reference, content.instanceId ?? node.id]);
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
