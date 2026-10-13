import type { PaneLayoutGroups } from '../../../lib/paneLayout/groups';
import { collectLeaves, isTermContent } from '../../../lib/paneLayout/query';
import { singlePane } from '../../../lib/paneLayout/ops';
import type { DockPayload, PaneLayout } from '../../../lib/paneLayout/types';
import { paneContentKey } from '../../../lib/paneLayout/contentIdentity';

/** Legacy local pane IDs remain supported only when they identify one live leaf. */
export type WorkspacePaneTarget = string | { contentId: string };

/** A canonical canvas owner, not a second inventory of open content. */
export interface WorkspaceCanvas {
    owner: string;
    layout: PaneLayout;
}

/**
 * Join existing pane groups with ungrouped shells for connection-wide operations.
 * Grouped and hidden shells are not manufactured again as standalone canvases.
 * Preserve group/leaf objects and duplicates in the source: validation must reject
 * ambiguous ownership, not silently deduplicate it. Inputs are restored live state,
 * not unvalidated session JSON.
 */
export function workspaceCanvases(
    terminals: readonly { id: string }[], groups: PaneLayoutGroups | undefined,
): WorkspaceCanvas[] {
    const canvases = Object.entries(groups ?? {}).map(([owner, layout]) => ({ owner, layout }));
    const groupedTerms = new Set(canvases.flatMap(({ layout }) => collectLeaves(layout.root)
        .flatMap(leaf => isTermContent(leaf.content) ? [leaf.content.termId] : [])));
    for (const terminal of terminals) {
        if (!groupedTerms.has(terminal.id)) canvases.push({ owner: terminal.id, layout: singlePane(terminal.id, terminal.id) });
    }
    return canvases;
}

/** Resolve fresh canonical ownership; never pick the first of ambiguous matches. */
export function findWorkspacePane(canvases: readonly WorkspaceCanvas[], target: WorkspacePaneTarget) {
    const matches = canvases.flatMap(canvas => collectLeaves(canvas.layout.root)
        .filter(leaf => typeof target === 'string' ? leaf.id === target
            : paneContentKey(leaf.content, leaf.id) === target.contentId)
        .map(leaf => ({ ...canvas, leaf })));
    return matches.length === 1 ? matches[0] : undefined;
}

/** Match both drag identity and its optional leaf hint; stale/ambiguous drags never create replacements. */
export function workspacePaneForDockPayload(canvases: readonly WorkspaceCanvas[], payload: DockPayload) {
    const matches = canvases.flatMap(canvas => collectLeaves(canvas.layout.root).filter(leaf => {
        if (payload.sourcePaneId && leaf.id !== payload.sourcePaneId) return false;
        const content = leaf.content;
        if (content.kind === 'term' && payload.kind === 'term') return content.termId === payload.termId;
        if (content.kind === 'feature' && payload.kind === 'feature') return content.featureId === payload.featureId
            && (payload.instanceId ? content.instanceId === payload.instanceId : Boolean(payload.sourcePaneId));
        if (content.kind === 'plugin' && payload.kind === 'plugin') return content.pluginId === payload.pluginId
            && (!payload.instanceId || content.instanceId === payload.instanceId);
        return false;
    }).map(leaf => ({ ...canvas, leaf })));
    return matches.length > 1 || (payload.sourcePaneId && matches.length === 0)
        ? { ok: false as const } : { ok: true as const, pane: matches[0] };
}
