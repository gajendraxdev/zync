import { paneContentKey } from '../../../lib/paneLayout/contentIdentity';
import { collectLeaves } from '../../../lib/paneLayout/query';
import type { PaneLayoutGroups } from '../../../lib/paneLayout/groups';
import type { PaneContent, PaneLayout, PaneLeaf } from '../../../lib/paneLayout/types';

export interface ContentInventoryItem {
    id: string;
    content: PaneContent;
    paneId?: string;
    owner?: string;
    /** Dynamic terminal title; registered labels are resolved by presentation. */
    title?: string;
}

/** Canonical live content only. Registration lists and presentation metadata cannot open panes. */
export function deriveWorkspaceContentInventory(
    terminals: readonly { id: string; title: string }[],
    groups: PaneLayoutGroups | null | undefined,
): ContentInventoryItem[] {
    const byId = new Map<string, ContentInventoryItem>();
    for (const terminal of terminals) {
        const content: PaneContent = { kind: 'term', termId: terminal.id };
        const id = paneContentKey(content, terminal.id);
        if (!byId.has(id)) byId.set(id, { id, content, title: terminal.title });
    }
    const located = new Set<string>();
    for (const [owner, layout] of Object.entries(groups ?? {})) {
        for (const pane of collectLeaves(layout.root)) {
            const id = paneContentKey(pane.content, pane.id);
            if (located.has(id)) continue;
            located.add(id);
            byId.set(id, { ...byId.get(id), id, content: pane.content, paneId: pane.id, owner });
        }
    }
    return [...byId.values()];
}

/** Resolve at action time: docking can change the owner or pane allocation after rendering. */
export function findWorkspaceContentPane(
    groups: PaneLayoutGroups | null | undefined,
    contentId: string,
): { owner: string; layout: PaneLayout; pane: PaneLeaf } | undefined {
    for (const [owner, layout] of Object.entries(groups ?? {})) {
        const pane = collectLeaves(layout.root).find(leaf => paneContentKey(leaf.content, leaf.id) === contentId);
        if (pane) return { owner, layout, pane };
    }
    return undefined;
}
