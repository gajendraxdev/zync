import { collectLeaves } from '../../../lib/paneLayout/query';
import { paneContentKey } from '../../../lib/paneLayout/contentIdentity';
import type { DockPayload } from '../../../lib/paneLayout/types';
import { workspaceCanvases, workspacePaneForDockPayload, type WorkspaceCanvas } from './canvases';
import type { PaneLayoutGroups } from '../../../lib/paneLayout/groups';
import { deriveWorkspaceContentInventory } from './contentInventory';
import { MAX_PRESENTATION_ITEMS_PER_SCOPE, sortContentPresentation, type ContentPresentationScope } from './contentPresentation';

/** Gesture snapshot, not a second inventory. Membership and pinning are rechecked on release. */
export interface PaneTabReleaseSource {
    contentId: string;
    memberIds: readonly string[];
    pinned: boolean;
}
export interface PaneTabInsertion {
    source: PaneTabReleaseSource;
    target: readonly string[];
    after: boolean;
}
const keys = (canvas: WorkspaceCanvas) => collectLeaves(canvas.layout.root).map(pane => paneContentKey(pane.content, pane.id));
const sameMembers = (a: readonly string[], b: readonly string[]) => a.length === b.length
    && new Set(a).size === a.length && a.every(id => b.includes(id));

/** Only an existing exact pane can leave a split; missing drag resources are never manufactured. */
export function paneTabReleaseSource(canvases: readonly WorkspaceCanvas[], payload: DockPayload, scope?: ContentPresentationScope): PaneTabReleaseSource | null {
    const found = workspacePaneForDockPayload(canvases, payload);
    if (!found.ok || !found.pane) return null;
    const contentId = paneContentKey(found.pane.leaf.content, found.pane.leaf.id);
    if (scope?.items[contentId]?.hidden) return null;
    return { contentId, memberIds: keys(found.pane), pinned: scope?.items[contentId]?.pinned === true };
}

/** Plan rank metadata before any layout mutation. Own-group drops anchor to its remaining members.
 * Preserve dormant ranks and pin buckets; stale/ambiguous membership fails without partial unsplitting.
 */
export function planPaneTabInsertion(terminals: readonly { id: string; title: string }[], layouts: PaneLayoutGroups | undefined,
    scope: ContentPresentationScope | undefined, insertion: PaneTabInsertion): string[] | null {
    const canvases = workspaceCanvases(terminals, layouts);
    const { source, target, after } = insertion;
    if (typeof after !== 'boolean' || !source.memberIds.includes(source.contentId)) return null;
    const groups = canvases.map(keys);
    const sourceGroups = groups.filter(ids => ids.includes(source.contentId));
    if (sourceGroups.length !== 1 || !sameMembers(sourceGroups[0], source.memberIds)
        || scope?.items[source.contentId]?.hidden || (scope?.items[source.contentId]?.pinned === true) !== source.pinned
        || groups.filter(ids => sameMembers(ids, target)).length !== 1) return null;
    const visibleAnchors = target.filter(id => id !== source.contentId && !scope?.items[id]?.hidden);
    if (!visibleAnchors.length || visibleAnchors.some(id => scope?.items[id]?.pinned === true) !== source.pinned) return null;
    const anchors = visibleAnchors.filter(id => (scope?.items[id]?.pinned === true) === source.pinned);
    const liveIds = groups.flat();
    if (new Set(liveIds).size !== liveIds.length) return null;
    const ordered = sortContentPresentation(deriveWorkspaceContentInventory(terminals, layouts), scope).map(item => item.id);
    const remaining = ordered.filter(id => id !== source.contentId);
    const indices = remaining.flatMap((id, index) => anchors.includes(id) ? [index] : []);
    remaining.splice(after ? Math.max(...indices) + 1 : Math.min(...indices), 0, source.contentId);
    const live = new Set(liveIds);
    const prior = scope?.order ?? [];
    const slots = [...prior, ...ordered.filter(id => !prior.includes(id))];
    if (new Set([...slots, ...Object.keys(scope?.items ?? {})]).size > MAX_PRESENTATION_ITEMS_PER_SCOPE) return null;
    let index = 0;
    return slots.map(id => live.has(id) ? remaining[index++] : id);
}
