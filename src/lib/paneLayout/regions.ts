import { paneContentKey } from './contentIdentity';
import { collectLeaves, isSafePaneLayout } from './query';
import { projectVisiblePaneLayout } from './visibility';
import type { PaneLayout } from './types';

/** Host allocation areas, not feature kinds or permission-bearing plugin slots. */
export const PANE_REGIONS = ['workspace', 'primary-sidebar', 'secondary-sidebar', 'bottom-panel'] as const;
export type PaneRegion = (typeof PANE_REGIONS)[number];
export type PaneRegionAssignments = ReadonlyMap<string, PaneRegion>;
export type PaneRegionLayouts = Readonly<Record<PaneRegion, PaneLayout | null>>;

/** Fractional geometry shared by navigation and drop previews; it never owns resources. */
export function paneRegionBounds(occupied: ReadonlySet<PaneRegion>, sizes?: Partial<PaneRegionSizes>) {
    const safe = normalizePaneRegionSizes(sizes);
    const primary = occupied.has('primary-sidebar') ? safe.primary : 0;
    const secondary = occupied.has('secondary-sidebar') ? safe.secondary : 0;
    const bottom = occupied.has('bottom-panel') ? safe.bottom : 0;
    const width = 1 - primary - secondary;
    return {
        workspace: { x: primary, y: 0, w: width, h: 1 - bottom },
        'primary-sidebar': { x: 0, y: 0, w: primary, h: 1 },
        'secondary-sidebar': { x: 1 - secondary, y: 0, w: secondary, h: 1 },
        'bottom-panel': { x: primary, y: 1 - bottom, w: width, h: bottom },
    };
}

export function isPaneRegion(value: unknown): value is PaneRegion {
    return typeof value === 'string' && PANE_REGIONS.some(region => region === value);
}

export type PaneRegionMove =
    | { ok: true; assignments: PaneRegionAssignments }
    | { ok: false; reason: 'invalid-layout' | 'missing-content' | 'unsupported-location' };

/**
 * Shared pointer/keyboard preflight for an already-owned instance. The composition
 * owner supplies its registration's allowed locations. This operation cannot open,
 * close, reveal, duplicate or transfer content across connection/canvas ownership.
 * Assignments are an in-memory prototype contract, not a persisted session schema.
 */
export function movePaneRegion(
    layout: PaneLayout,
    assignments: PaneRegionAssignments,
    contentId: string,
    destination: PaneRegion,
    allowedLocations: readonly PaneRegion[],
): PaneRegionMove {
    if (!isSafePaneLayout(layout)) return { ok: false, reason: 'invalid-layout' };
    if (!isPaneRegion(destination) || !allowedLocations.includes(destination)) {
        return { ok: false, reason: 'unsupported-location' };
    }
    const matches = collectLeaves(layout.root).filter(leaf => paneContentKey(leaf.content, leaf.id) === contentId);
    if (matches.length !== 1) return { ok: false, reason: 'missing-content' };
    if ((assignments.get(contentId) ?? 'workspace') === destination) return { ok: true, assignments };
    const next = new Map(assignments);
    if (destination === 'workspace') next.delete(contentId);
    else next.set(contentId, destination);
    return { ok: true, assignments: next };
}

/**
 * Partition a validated canonical canvas into geometry-only projections. Each
 * visible leaf occurs once; hidden leaves still count in the canonical four-pane
 * budget. Pruning reuses the visibility projection, preserving surviving IDs,
 * ratios and structural sharing. Never persist these projections as live inventory.
 * Canvas selection and cross-canvas dock visibility belong to the shell adapter.
 */
export function projectPaneRegions(
    layout: PaneLayout,
    assignments: PaneRegionAssignments,
    hiddenContentIds: ReadonlySet<string>,
): PaneRegionLayouts {
    const leaves = collectLeaves(layout.root);
    const project = (region: PaneRegion) => {
        const excluded = new Set(hiddenContentIds);
        for (const leaf of leaves) {
            const key = paneContentKey(leaf.content, leaf.id);
            if ((assignments.get(key) ?? 'workspace') !== region) excluded.add(key);
        }
        return projectVisiblePaneLayout(layout, excluded);
    };
    return {
        workspace: project('workspace'),
        'primary-sidebar': project('primary-sidebar'),
        'secondary-sidebar': project('secondary-sidebar'),
        'bottom-panel': project('bottom-panel'),
    };
}

export interface PaneRegionSizes {
    primary: number;
    secondary: number;
    bottom: number;
}

/** Shared persistence/interaction bounds; fractions are relative to the whole workspace. */
export const PANE_REGION_SIZE_RULES = {
    'primary-sidebar': { key: 'primary', min: 0.15, max: 0.35, initial: 0.24 },
    'secondary-sidebar': { key: 'secondary', min: 0.15, max: 0.35, initial: 0.24 },
    'bottom-panel': { key: 'bottom', min: 0.2, max: 0.5, initial: 0.32 },
} as const;

/** Fractions of the whole canvas; side limits leave at least 30% for the center. */
export function normalizePaneRegionSizes(value: Partial<PaneRegionSizes> = {}): PaneRegionSizes {
    const bound = (region: keyof typeof PANE_REGION_SIZE_RULES) => {
        const { key, initial, min, max } = PANE_REGION_SIZE_RULES[region];
        const input = value[key];
        return typeof input === 'number' && Number.isFinite(input) ? Math.max(min, Math.min(max, input)) : initial;
    };
    return {
        primary: bound('primary-sidebar'),
        secondary: bound('secondary-sidebar'),
        bottom: bound('bottom-panel'),
    };
}
