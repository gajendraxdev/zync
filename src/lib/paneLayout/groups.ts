import { parsePaneLayout } from './persist';
import { dropTerm, sanitizePaneLayout } from './ops';
import {
    activeTermId,
    collectLeaves,
    firstTermLeaf,
    isFeatureContent,
    isPaneLeaf,
    isSafePaneLayout,
    isSplitLayout,
    isTermContent,
    visibleTermIds,
} from './query';
import type { PaneLayout } from './types';

/** owner tab id → split tree. One host can have several split tabs. */
export type PaneLayoutGroups = Record<string, PaneLayout>;

/** Layout owner when there is no shell (Files-only / mixed feature splits). */
export const WORKSPACE_PANE_OWNER = 'workspace';

export function sameSplitGroup(
    groups: PaneLayoutGroups | null | undefined,
    termA: string,
    termB: string,
): boolean {
    if (!termA || !termB) return false;
    return (findLayoutOwner(groups, termA) ?? termA) === (findLayoutOwner(groups, termB) ?? termB);
}

/** Whether the dragged shell is already visible in this exact pane layout. */
export function sameGroupTermDock(
    groups: PaneLayoutGroups | null | undefined,
    owner: string,
    termId: string,
): 'self' | null {
    const layout = groups?.[owner];
    return layout && visibleTermIds(layout).includes(termId) ? 'self' : null;
}

export function findLayoutOwner(
    groups: PaneLayoutGroups | null | undefined,
    termId: string,
): string | null {
    if (!groups) return null;
    if (termId) {
        if (groups[termId] && isSplitLayout(groups[termId])) return termId;
        for (const [owner, layout] of Object.entries(groups)) {
            if (visibleTermIds(layout).includes(termId)) return owner;
        }
    }
    return null;
}

export function layoutForTerm(
    groups: PaneLayoutGroups | null | undefined,
    termId: string,
): PaneLayout | undefined {
    const owner = findLayoutOwner(groups, termId);
    return owner ? groups![owner] : undefined;
}

export function layoutForCanvas(
    groups: PaneLayoutGroups | null | undefined,
    termId: string | null | undefined,
    groupOwner?: string | null,
): PaneLayout | undefined {
    if (groupOwner && groups?.[groupOwner]) return groups[groupOwner];
    if (termId) {
        const owned = layoutForTerm(groups, termId);
        if (owned) return owned;
    }
    return groups?.[WORKSPACE_PANE_OWNER];
}

export function layoutForFeatureInstance(
    groups: PaneLayoutGroups | null | undefined,
    instanceId: string | null | undefined,
): PaneLayout | undefined {
    if (!groups || !instanceId) return undefined;
    if (groups[instanceId]) return groups[instanceId];
    for (const layout of Object.values(groups)) {
        for (const leaf of collectLeaves(layout.root)) {
            if (isFeatureContent(leaf.content) && leaf.content.instanceId === instanceId) {
                return layout;
            }
        }
    }
    return undefined;
}

/** Prefer the layout's focused leaf over a stale active-terminal id after restore. */
export function focusedTermIdForRestore(
    groups: PaneLayoutGroups | null | undefined,
    requestedTermId: string | null | undefined,
    fallbackTermId: string | null,
): string | null {
    const fromLayout = (termId: string | null | undefined): string | null => {
        if (!termId || !groups) return null;
        const owner = findLayoutOwner(groups, termId);
        if (!owner) return null;
        return activeTermId(groups[owner]) ?? termId;
    };
    return fromLayout(requestedTermId)
        ?? fromLayout(fallbackTermId)
        ?? requestedTermId
        ?? fallbackTermId;
}

/**
 * Drop one shell from its split group without closing the rest.
 * Rekeys the group when the owner tab's PTY is the one that left.
 */
export function detachTermFromGroups(
    groups: PaneLayoutGroups | undefined,
    termId: string,
): {
    next: PaneLayoutGroups | undefined;
    remainingIds: string[];
    nextOwner: string | null;
} {
    const owner = findLayoutOwner(groups, termId);
    if (!owner || !groups) {
        return { next: groups, remainingIds: [], nextOwner: null };
    }
    const layout = groups[owner];
    if (!layout) {
        return { next: groups, remainingIds: [], nextOwner: null };
    }

    const dropped = dropTerm(layout, termId);
    const next: PaneLayoutGroups = { ...groups };
    delete next[owner];
    const remainingIds = dropped ? visibleTermIds(dropped).filter((id) => id !== termId) : [];

    if (dropped && (isSplitLayout(dropped) || (isPaneLeaf(dropped.root) && !isTermContent(dropped.root.content)))) {
        let nextOwner = remainingIds.includes(owner) ? owner : remainingIds[0] ?? null;
        if (!nextOwner) {
            const featureLeaf = collectLeaves(dropped.root).find((leaf) => (
                isFeatureContent(leaf.content) && leaf.content.instanceId
            ));
            nextOwner = (featureLeaf && isFeatureContent(featureLeaf.content) && featureLeaf.content.instanceId)
                ? featureLeaf.content.instanceId
                : owner;
        }
        next[nextOwner] = dropped;
        return { next, remainingIds, nextOwner };
    }

    return {
        next: Object.keys(next).length > 0 ? next : undefined,
        remainingIds,
        nextOwner: remainingIds[0] ?? null,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isLegacyLayout(raw: Record<string, unknown>): boolean {
    return 'root' in raw && 'activePaneId' in raw;
}

function hasValidGroupOwner(
    owner: string,
    layout: PaneLayout,
    knownTermIds: ReadonlySet<string>,
): boolean {
    if (owner === WORKSPACE_PANE_OWNER) return true;
    const termIds = visibleTermIds(layout);
    if (knownTermIds.has(owner)) return termIds.includes(owner);
    return collectLeaves(layout.root).some((leaf) => (
        isFeatureContent(leaf.content) && leaf.content.instanceId === owner
    ));
}

/** Restore per-tab groups. Old session files stored one tree per host. */
export function parsePaneLayoutGroups(raw: unknown, knownTermIds: ReadonlySet<string>): PaneLayoutGroups {
    if (!isRecord(raw)) return {};
    if (isLegacyLayout(raw)) {
        const layout = parsePaneLayout(raw, knownTermIds);
        if (!layout || !isSplitLayout(layout)) return {};
        const leaf = firstTermLeaf(layout.root);
        const owner = leaf && leaf.content.kind === 'term' ? leaf.content.termId : '';
        if (!owner || !knownTermIds.has(owner)) return {};
        return { [owner]: layout };
    }
    const out: PaneLayoutGroups = {};
    const seen = new Set<string>();
    for (const [owner, value] of Object.entries(raw)) {
        const isWorkspace = owner === WORKSPACE_PANE_OWNER;
        const layout = parsePaneLayout(value, knownTermIds);
        if (!layout || !isSplitLayout(layout)) continue;
        const ids = visibleTermIds(layout);
        if (!isWorkspace && !hasValidGroupOwner(owner, layout, knownTermIds)) continue;
        if (!ids.every((id) => knownTermIds.has(id))) continue;
        if (ids.some((id) => seen.has(id))) continue;
        for (const id of ids) seen.add(id);
        out[owner] = layout;
    }
    return out;
}

export function snapshotPaneLayoutGroups(
    layouts: Record<string, PaneLayoutGroups | null | undefined>,
    terminals: Record<string, { id: string }[]>,
): Record<string, PaneLayoutGroups> {
    const out: Record<string, PaneLayoutGroups> = {};
    for (const [scopeId, groups] of Object.entries(layouts)) {
        if (!groups) continue;
        const known = new Set((terminals[scopeId] ?? []).map((tab) => tab.id));
        const groupOut: PaneLayoutGroups = {};
        for (const [owner, layout] of Object.entries(groups)) {
            const isWorkspace = owner === WORKSPACE_PANE_OWNER;
            if (!layout) continue;
            const clean = sanitizePaneLayout(layout, known);
            if (!clean || !isSplitLayout(clean) || !isSafePaneLayout(clean)) continue;
            const ids = visibleTermIds(clean);
            if (!isWorkspace && !hasValidGroupOwner(owner, clean, known)) continue;
            if (!ids.every((id) => known.has(id))) continue;
            groupOut[owner] = clean;
        }
        if (Object.keys(groupOut).length > 0) {
            out[scopeId] = groupOut;
        }
    }
    return out;
}
