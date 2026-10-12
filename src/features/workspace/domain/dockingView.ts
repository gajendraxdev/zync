import type { SplitFeatureId } from '../../../lib/paneLayout/types';
import { findWorkspacePane, workspaceCanvases } from './canvases';
import { parseWorkspaceDocking } from './docking';
import { projectWorkspaceDocking, projectMaximizedWorkspacePane, type MaximizedWorkspacePane } from './dockingProjection';
import { hiddenWorkspaceContent, resolveWorkspaceCanvas, type WorkspaceContentState } from './visibleContent';

export interface WorkspaceDockingState extends Omit<WorkspaceContentState, 'workspaceDocking'> {
    workspaceDocking?: unknown;
    /** Transient input ownership; focusing a dock never replaces center selection. */
    workspaceDockFocus?: Record<string, string | null>;
    maximizedWorkspacePanes?: Record<string, MaximizedWorkspacePane | undefined>;
}

export interface WorkspaceCanvasSelection {
    featureInstanceId?: string;
    pluginPanelId?: string;
    featureId?: SplitFeatureId;
}

/** Resolve the visible input owner using exactly the renderer's region selection. */
export function workspaceSplitTarget(state: WorkspaceDockingState, scope: string, selection: WorkspaceCanvasSelection = {}) {
    const view = workspaceDockingView(state, scope, selection);
    const contentId = view.projection.ok ? view.projection.value.focusedContentId : null;
    return contentId ? findWorkspacePane(view.canvases, { contentId }) : undefined;
}

/**
 * Shared renderer/action allocation from the existing resource owners. Unknown
 * metadata or ambiguous/over-cap topology has no partial visible allocation;
 * callers retain hosts and offer recovery rather than dropping saved preferences.
 */
export function workspaceDockingView(state: WorkspaceDockingState, scope: string, selection: WorkspaceCanvasSelection = {}, hiddenOverride?: ReadonlySet<string>) {
    return projectWorkspaceDockingView(state, scope, parseWorkspaceDocking(state.workspaceDocking), selection, hiddenOverride);
}

/**
 * Allocate from an already validated preference snapshot. Renderers can memoize
 * that read by immutable preference identity, avoiding envelope-wide validation
 * on focus/tab changes. Actions use workspaceDockingView to validate afresh.
 * Validation failures stay failures; this never silently narrows the envelope.
 */
export function projectWorkspaceDockingView(state: Omit<WorkspaceDockingState, 'workspaceDocking'>, scope: string,
    parsed: ReturnType<typeof parseWorkspaceDocking>, selection: WorkspaceCanvasSelection = {}, hiddenOverride?: ReadonlySet<string>) {
    const canvases = workspaceCanvases(state.terminals[scope] ?? [], state.paneLayouts[scope]);
    if (!parsed.ok) return { canvases, projection: parsed };
    const canonical = resolveWorkspaceCanvas(state.paneLayouts[scope], state.activeTerminalIds[scope],
        state.activePaneGroupOwner[scope], selection.featureInstanceId, selection.pluginPanelId, selection.featureId);
    const selectedOwner = canvases.find(canvas => canvas.layout === canonical)?.owner
        ?? (!selection.pluginPanelId && !selection.featureId && !selection.featureInstanceId
            ? canvases.find(canvas => canvas.owner === state.activeTerminalIds[scope])?.owner : undefined) ?? null;
    const preferences = parsed.value[scope];
    const hidden = hiddenWorkspaceContent({ ...state, workspaceDocking: parsed.value }, scope);
    const base = projectWorkspaceDocking(canvases, new Map(Object.entries(preferences?.placements ?? {})),
        hiddenOverride ? new Set([...hidden, ...hiddenOverride]) : hidden, selectedOwner, state.workspaceDockFocus?.[scope]);
    return {
        canvases, preferences, selectedOwner,
        projection: base.ok ? { ...base, value: projectMaximizedWorkspacePane(base.value, state.maximizedWorkspacePanes?.[scope], selectedOwner) } : base,
    };
}
