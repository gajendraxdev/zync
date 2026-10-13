import { paneContentKey } from './contentIdentity';
import { findNode, firstLeaf, isPaneLeaf } from './query';
import type { PaneLayout, PaneNode } from './types';

/**
 * Project allocation geometry without changing the canonical tree or live content.
 * Hidden leaves remain in that canonical tree for retention, persistence and cap
 * checks. Callers must not use this visible projection as their resource inventory.
 */
export function projectVisiblePaneLayout(
    layout: PaneLayout,
    hiddenContentIds: ReadonlySet<string>,
): PaneLayout | null {
    if (hiddenContentIds.size === 0) return layout;
    const visit = (node: PaneNode): PaneNode | null => {
        if (isPaneLeaf(node)) {
            return hiddenContentIds.has(paneContentKey(node.content, node.id)) ? null : node;
        }
        const first = visit(node.children[0]);
        const second = visit(node.children[1]);
        if (!first) return second;
        if (!second) return first;
        if (first === node.children[0] && second === node.children[1]) return node;
        return { ...node, children: [first, second] };
    };
    const root = visit(layout.root);
    if (!root) return null;
    if (root === layout.root) return layout;
    const active = findNode(root, layout.activePaneId);
    return {
        ...layout,
        root,
        activePaneId: active && isPaneLeaf(active) ? active.id : firstLeaf(root).id,
    };
}
