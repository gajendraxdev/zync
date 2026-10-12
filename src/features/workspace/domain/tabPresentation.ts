import { sortContentPresentation, type ContentPresentationScope } from './contentPresentation';

/** A strip entry represents one content instance or one existing split canvas. */
export interface WorkspaceTabDescriptor {
    id: string;
    contentIds: readonly string[];
}

/**
 * Project chrome only. A split follows its earliest projected member, including
 * any pinned member; its mutable canvas owner never becomes a preference key.
 * Supplied tab order remains the default when no live preference changes it.
 */
export function projectWorkspaceTabs<T extends WorkspaceTabDescriptor>(
    tabs: readonly T[],
    scope?: ContentPresentationScope,
): Array<{ item: T; pinned: boolean }> {
    const content = [...new Set(tabs.flatMap(tab => tab.contentIds))]
        .filter(id => !scope?.items[id]?.hidden).map(id => ({ id }));
    const ordered = sortContentPresentation(content, scope);
    const rank = new Map(ordered.map((item, index) => [item.id, index]));
    return tabs.map((item, index) => {
        let firstRank = Infinity;
        let pinned = false;
        for (const id of item.contentIds) {
            const candidateRank = rank.get(id);
            if (candidateRank !== undefined && candidateRank < firstRank) {
                firstRank = candidateRank;
                pinned = scope?.items[id]?.pinned === true;
            }
        }
        return { item, index, rank: firstRank, pinned };
    }).filter(item => item.rank !== Infinity)
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.rank - b.rank || a.index - b.index)
        .map(({ item, pinned }) => ({ item, pinned }));
}
