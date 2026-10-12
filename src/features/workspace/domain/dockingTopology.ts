import type { PaneLayoutGroups } from '../../../lib/paneLayout/groups';
import { collectLeaves } from '../../../lib/paneLayout/query';
import { paneContentKey } from '../../../lib/paneLayout/contentIdentity';
import { MAX_VISIBLE_PANES, type PaneLayout } from '../../../lib/paneLayout/types';
import { findWorkspacePane, workspaceCanvases, type WorkspacePaneTarget } from './canvases';
import { parseWorkspaceDocking, workspaceDockingCapacity, workspaceDockingMoveCapacity } from './docking';

interface DockingTopologyState {
    workspaceDocking?: unknown;
    terminals: Record<string, readonly { id: string }[] | undefined>;
    paneLayouts: Record<string, PaneLayoutGroups | undefined>;
}

/**
 * Validate proposed resource topology before copying listings or publishing state.
 * Default metadata keeps existing behavior; unknown formats refuse creation rather
 * than stripping preferences. Hidden resources still consume docking reservations.
 */
export function allowsDockingTopology(
    state: Pick<DockingTopologyState, 'workspaceDocking'>, scope: string,
    terminals: readonly { id: string }[], groups: PaneLayoutGroups | undefined,
): boolean {
    const parsed = parseWorkspaceDocking(state.workspaceDocking);
    if (!parsed.ok) return false;
    const placements = parsed.value[scope]?.placements;
    if (!placements || Object.keys(placements).length === 0) return true;
    return workspaceDockingCapacity(workspaceCanvases(terminals, groups).map(canvas => canvas.layout),
        new Map(Object.entries(placements))).ok;
}

/**
 * Prepare allocation metadata for a new duplicate without publishing resources.
 * Source and duplicate keep independent identities but share a location. Parsing
 * the candidate enforces bounded metadata before the complete topology preflight.
 */
export function dockingForDuplicate(value: unknown, scope: string, sourceId: string, duplicateId: string) {
    const parsed = parseWorkspaceDocking(value);
    if (!parsed.ok) return parsed;
    const existing = parsed.value[scope];
    const region = existing?.placements[sourceId];
    if (!region) return parsed;
    return parseWorkspaceDocking({ ...parsed.value, [scope]: {
        ...existing, placements: { ...existing.placements, [duplicateId]: region },
    } });
}

/** Plan a move or insertion beside a target, including returning docked content to the center. */
export function dockingBesideTarget(value: unknown, scope: string, targetId: string, incomingId: string) {
    const parsed = parseWorkspaceDocking(value);
    if (!parsed.ok) return parsed;
    const existing = parsed.value[scope];
    if (!existing) return parsed;
    const placements = { ...existing.placements };
    const region = placements[targetId];
    if (region) placements[incomingId] = region;
    else delete placements[incomingId];
    return parseWorkspaceDocking({ ...parsed.value, [scope]: { ...existing, placements } });
}

/**
 * Preflight a new center pane before a multi-step caller creates its shell. The
 * final store mutation still validates the full candidate topology. A refused
 * split must not leave an orphan shell tab or start a PTY in the background.
 * `target` is a live canonical canvas (including a standalone shell); omit it
 * when seeding a new canvas and include every seed pane in `additional`.
 */
export function allowsAdditionalCenterPane(
    state: DockingTopologyState, scope: string, target: PaneLayout | undefined, additional = 1,
): boolean {
    if (!Number.isInteger(additional) || additional < 1 || additional > MAX_VISIBLE_PANES) return false;
    const parsed = parseWorkspaceDocking(state.workspaceDocking);
    if (!parsed.ok) return false;
    const canvases = workspaceCanvases(state.terminals[scope] ?? [], state.paneLayouts[scope]);
    const leaves = target ? collectLeaves(target.root) : [];
    if (leaves.length + additional > MAX_VISIBLE_PANES) return false;
    const placements = new Map(Object.entries(parsed.value[scope]?.placements ?? {}));
    const capacity = workspaceDockingCapacity(canvases.map(item => item.layout), placements);
    const mainCount = leaves.filter(leaf => !placements.has(paneContentKey(leaf.content, leaf.id))).length;
    return capacity.ok && mainCount + additional <= capacity.availableMainPanes;
}

/**
 * Reserve one new pane beside an exact existing resource. A peripheral insertion
 * consumes a shared dock slot against every canvas, not just the selected center.
 * This read-only UI preflight is repeated against the complete store plan at commit.
 */
export function allowsAdditionalPaneBeside(state: DockingTopologyState, scope: string, target: WorkspacePaneTarget): boolean {
    const parsed = parseWorkspaceDocking(state.workspaceDocking);
    if (!parsed.ok) return false;
    const canvases = workspaceCanvases(state.terminals[scope] ?? [], state.paneLayouts[scope]);
    const source = findWorkspacePane(canvases, target);
    if (!source || collectLeaves(source.layout.root).length >= MAX_VISIBLE_PANES) return false;
    const placements = new Map(Object.entries(parsed.value[scope]?.placements ?? {}));
    const capacity = workspaceDockingCapacity(canvases.map(item => item.layout), placements);
    if (!capacity.ok) return false;
    const centerCount = (layout: PaneLayout) => collectLeaves(layout.root)
        .filter(leaf => !placements.has(paneContentKey(leaf.content, leaf.id))).length;
    if (!placements.has(paneContentKey(source.leaf.content, source.leaf.id))) {
        return centerCount(source.layout) + 1 <= capacity.availableMainPanes;
    }
    return capacity.availableMainPanes >= 1
        && canvases.every(({ layout }) => centerCount(layout) <= capacity.availableMainPanes - 1);
}

/** Capacity-only preview of an existing resource move; never reserve it a second time. */
export function allowsExistingPaneBeside(state: DockingTopologyState, scope: string, incomingId: string, targetId: string): boolean {
    const allocation = dockingBesideTarget(state.workspaceDocking, scope, targetId, incomingId);
    if (!allocation.ok) return false;
    return workspaceDockingMoveCapacity(workspaceCanvases(state.terminals[scope] ?? [], state.paneLayouts[scope]).map(canvas => canvas.layout),
        new Map(Object.entries(allocation.value[scope]?.placements ?? {})), incomingId, targetId);
}
