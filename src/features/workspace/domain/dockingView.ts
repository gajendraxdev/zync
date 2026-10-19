import type { SplitFeatureId } from '../../../lib/paneLayout/types';
import { isSplitLayout, isTermContent } from '../../../lib/paneLayout/query';
import { paneContentKey } from '../../../lib/paneLayout/contentIdentity';
import { findWorkspacePane, workspaceCanvases } from './canvases';
import { parseWorkspaceDocking } from './docking';
import { allowsAdditionalPaneBeside } from './dockingTopology';
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
 * One-entry toolbar projection keyed by immutable layout inputs, not the entire
 * app store. Progress ticks must not rebuild canvases/validate docking metadata.
 * Each mounted consumer owns its selector; no global cache or snapshot history.
 * Actions still use workspaceSplitTarget and repeat capacity checks on live state.
 */
export function createWorkspaceSplitControlsSelector(scope: string, selection: WorkspaceCanvasSelection = {}) {
    const selected = { ...selection };
    let previous: unknown[] | undefined;
    let result: { isSplit: boolean; canSplit: boolean; terminalId: string | null };
    return (state: WorkspaceDockingState) => {
        const inputs = [state.terminals[scope], state.paneLayouts[scope], state.activeTerminalIds[scope],
            state.activePaneGroupOwner[scope], state.contentPresentation?.[scope], state.workspaceDocking,
            state.workspaceDockFocus?.[scope], state.maximizedWorkspacePanes?.[scope]];
        if (previous && inputs.every((value, index) => Object.is(value, previous![index]))) return result;
        const target = workspaceSplitTarget(state, scope, selected);
        result = {
            isSplit: isSplitLayout(target?.layout),
            canSplit: Boolean(target && allowsAdditionalPaneBeside(state, scope,
                { contentId: paneContentKey(target.leaf.content, target.leaf.id) })),
            terminalId: target && isTermContent(target.leaf.content) ? target.leaf.content.termId : null,
        };
        previous = inputs;
        return result;
    };
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
