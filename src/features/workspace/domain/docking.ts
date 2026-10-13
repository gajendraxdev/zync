import { collectLeaves, isSafePaneLayout } from '../../../lib/paneLayout/query';
import { paneContentKey } from '../../../lib/paneLayout/contentIdentity';
import { isPaneRegion, movePaneRegion, PANE_REGION_SIZE_RULES, type PaneRegion, type PaneRegionAssignments, type PaneRegionSizes } from '../../../lib/paneLayout/regions';
import { MAX_VISIBLE_PANES, type PaneLayout } from '../../../lib/paneLayout/types';
import {
    isContentPresentationKey, isPresentationScopeId,
    MAX_PRESENTATION_ITEMS_PER_SCOPE, MAX_PRESENTATION_SCOPES,
} from './contentPresentation';

export type DockedPaneRegion = Exclude<PaneRegion, 'workspace'>;
export interface WorkspaceDockingScope {
    version: 1;
    /** Stable live or dormant content IDs, never an inventory or a command to open content. */
    placements: Record<string, DockedPaneRegion>;
    sizes?: PaneRegionSizes;
}
export type WorkspaceDockingMap = Record<string, WorkspaceDockingScope>;

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validFraction(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Validate the complete bounded envelope before restoration or saving. Missing
 * means the existing layout; null, future formats and unknown fields are not
 * replaced with defaults. Dormant identities survive without activating resources.
 */
export function parseWorkspaceDocking(raw: unknown):
    { ok: true; value: WorkspaceDockingMap } | { ok: false; reason: 'unsupported-docking' } {
    if (raw === undefined) return { ok: true, value: {} };
    const unsupported = { ok: false, reason: 'unsupported-docking' } as const;
    if (!record(raw) || Object.keys(raw).length > MAX_PRESENTATION_SCOPES) return unsupported;
    const scopes: Array<[string, WorkspaceDockingScope]> = [];
    for (const [id, value] of Object.entries(raw)) {
        if (!isPresentationScopeId(id) || !record(value) || value.version !== 1
            || Object.keys(value).some(key => key !== 'version' && key !== 'placements' && key !== 'sizes')
            || !record(value.placements) || Object.keys(value.placements).length > MAX_PRESENTATION_ITEMS_PER_SCOPE) return unsupported;
        const placements: Array<[string, DockedPaneRegion]> = [];
        for (const [key, region] of Object.entries(value.placements)) {
            if (!isContentPresentationKey(key) || !isPaneRegion(region) || region === 'workspace') return unsupported;
            placements.push([key, region]);
        }
        let sizes: PaneRegionSizes | undefined;
        if (Object.prototype.hasOwnProperty.call(value, 'sizes')) {
            const candidate = value.sizes;
            if (!record(candidate) || Object.keys(candidate).some(key => !['primary', 'secondary', 'bottom'].includes(key))
                || !validFraction(candidate.primary, PANE_REGION_SIZE_RULES['primary-sidebar'].min, PANE_REGION_SIZE_RULES['primary-sidebar'].max)
                || !validFraction(candidate.secondary, PANE_REGION_SIZE_RULES['secondary-sidebar'].min, PANE_REGION_SIZE_RULES['secondary-sidebar'].max)
                || !validFraction(candidate.bottom, PANE_REGION_SIZE_RULES['bottom-panel'].min, PANE_REGION_SIZE_RULES['bottom-panel'].max)) return unsupported;
            sizes = { primary: candidate.primary, secondary: candidate.secondary, bottom: candidate.bottom };
        }
        if (placements.length || sizes) scopes.push([id, { version: 1, placements: Object.fromEntries(placements), ...(sizes && { sizes }) }]);
    }
    return { ok: true, value: Object.fromEntries(scopes) };
}

/** Remove explicitly addressed allocation preferences, preserving unrelated and future data. */
export function withoutWorkspaceDocking(raw: unknown, scope: string, contentIds: ReadonlySet<string>) {
    const parsed = parseWorkspaceDocking(raw);
    if (!parsed.ok || !parsed.value[scope]) return parsed;
    const current = parsed.value[scope];
    const placements = Object.fromEntries(Object.entries(current.placements).filter(([id]) => !contentIds.has(id)));
    return parseWorkspaceDocking({ ...parsed.value, [scope]: { ...current, placements } });
}

export type DockingCapacity =
    | { ok: true; dockedCount: number; availableMainPanes: number }
    | { ok: false; reason: 'invalid-layout' | 'duplicate-content' | 'capacity' };

/** Shared reservation arithmetic for actual and proposed canonical ownership. */
function capacityForCounts(counts: readonly { main: number; docked: number }[]): DockingCapacity {
    const dockedCount = counts.reduce((sum, item) => sum + item.docked, 0);
    const availableMainPanes = MAX_VISIBLE_PANES - dockedCount;
    if (availableMainPanes < 0 || counts.some(item => item.main > availableMainPanes)) return { ok: false, reason: 'capacity' };
    return { ok: true, dockedCount, availableMainPanes };
}

/**
 * Reserve persistent docks against every existing canvas in the same connection.
 * Hidden panes count too. A successful move therefore cannot make a later tab
 * switch exceed the four-pane budget. Callers include ungrouped shell canvases;
 * preferences never manufacture a canvas. New-canvas creation separately needs
 * at least one availableMainPanes slot, before any resource or listing is created.
 */
export function workspaceDockingCapacity(canvases: readonly PaneLayout[], assignments: PaneRegionAssignments): DockingCapacity {
    const seen = new Set<string>();
    const counts: Array<{ main: number; docked: number }> = [];
    for (const layout of canvases) {
        if (!isSafePaneLayout(layout)) return { ok: false, reason: 'invalid-layout' };
        let docked = 0; let main = 0;
        for (const leaf of collectLeaves(layout.root)) {
            const key = paneContentKey(leaf.content, leaf.id);
            if (seen.has(key)) return { ok: false, reason: 'duplicate-content' };
            seen.add(key);
            if ((assignments.get(key) ?? 'workspace') === 'workspace') main++;
            else docked++;
        }
        counts.push({ main, docked });
    }
    return capacityForCounts(counts);
}

/**
 * Preview moving an existing resource beside a target without constructing trees,
 * generating IDs or recording split animations. Assignments describe the proposed
 * destination. Actual tree movement and owner-collision checks remain store-owned.
 */
export function workspaceDockingMoveCapacity(canvases: readonly PaneLayout[], assignments: PaneRegionAssignments,
    incomingId: string, targetId: string): boolean {
    const current = workspaceDockingCapacity(canvases, assignments);
    if (!current.ok && current.reason !== 'capacity') return false;
    const keys = canvases.map(layout => collectLeaves(layout.root).map(leaf => paneContentKey(leaf.content, leaf.id)));
    const source = keys.findIndex(items => items.includes(incomingId));
    const target = keys.findIndex(items => items.includes(targetId));
    if (source < 0 || target < 0 || incomingId === targetId) return false;
    if (keys[target].length + (source === target ? 0 : 1) > MAX_VISIBLE_PANES) return false;
    return capacityForCounts(keys.map((items, index) => {
        const moved = index === source ? items.filter(id => id !== incomingId) : [...items];
        if (index === target) moved.push(incomingId);
        const docked = moved.filter(id => (assignments.get(id) ?? 'workspace') !== 'workspace').length;
        return { main: moved.length - docked, docked };
    })).ok;
}

/** Atomic preflight shared by all destination affordances; no selection or resource side effects. */
export function planWorkspaceDockMove(
    canvases: readonly PaneLayout[], assignments: PaneRegionAssignments,
    contentId: string, destination: PaneRegion, allowedLocations: readonly PaneRegion[],
): { ok: true; assignments: PaneRegionAssignments } | { ok: false; reason: 'missing-content' | 'unsupported-location' | 'invalid-layout' | 'duplicate-content' | 'capacity' } {
    if (!canvases.every(isSafePaneLayout)) return { ok: false, reason: 'invalid-layout' };
    const owner = canvases.find(layout => collectLeaves(layout.root).some(leaf => paneContentKey(leaf.content, leaf.id) === contentId));
    if (!owner) return { ok: false, reason: 'missing-content' };
    const move = movePaneRegion(owner, assignments, contentId, destination, allowedLocations);
    if (!move.ok) return move;
    const capacity = workspaceDockingCapacity(canvases, move.assignments);
    return capacity.ok ? move : capacity;
}
