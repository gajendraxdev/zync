import {
    collectLeaves, isTermContent, layoutForCanvas, layoutForFeatureInstance, layoutForPlugin, layoutHasFeature,
    paneContentKey, projectVisiblePaneLayout, singlePane,
    type PaneLayout, type PaneLayoutGroups, type SplitFeatureId,
} from '../../../lib/paneLayout';
import { deriveWorkspaceContentInventory, type ContentInventoryItem } from './contentInventory';
import { hiddenContentIds, sortContentPresentation, type ContentPresentationScope } from './contentPresentation';

export interface WorkspaceContentState {
    workspaceDocking?: import('./docking').WorkspaceDockingMap;
    workspaceDockFocus?: Record<string, string | null>;
    terminals: Record<string, Array<{ id: string; title: string; tabVisible?: boolean }>>;
    paneLayouts: Record<string, PaneLayoutGroups | undefined>;
    activeTerminalIds: Record<string, string | null>;
    activePaneGroupOwner: Record<string, string | null>;
    contentPresentation?: Record<string, ContentPresentationScope>;
}

/** Match the canvas renderer's precedence; content routing never creates a pane. */
export function resolveWorkspaceCanvas(
    groups: PaneLayoutGroups | undefined,
    activeTerminalId: string | null | undefined,
    activeOwner: string | null | undefined,
    featureInstanceId?: string,
    pluginPanelId?: string,
    featureId?: SplitFeatureId,
): PaneLayout | undefined {
    if (pluginPanelId) return layoutForPlugin(groups, pluginPanelId, activeOwner);
    if (featureInstanceId) return layoutForFeatureInstance(groups, featureInstanceId)
        ?? layoutForCanvas(groups, activeTerminalId, activeOwner);
    if (featureId) {
        const preferred = activeOwner ? groups?.[activeOwner] : undefined;
        return (preferred && layoutHasFeature(preferred, featureId) ? preferred : undefined)
            ?? Object.values(groups ?? {}).find(layout => layoutHasFeature(layout, featureId));
    }
    return layoutForCanvas(groups, activeTerminalId, activeOwner);
}

/** Live hidden identities only; dormant preferences never create or remove content. */
export function hiddenWorkspaceContent(state: WorkspaceContentState, scope: string): ReadonlySet<string> {
    return hiddenContentIds(deriveWorkspaceContentInventory(state.terminals[scope] ?? [], state.paneLayouts[scope]),
        state.contentPresentation?.[scope]);
}

/** Resolve the focused canonical leaf, including a standalone shell, before hiding it. */
export function selectedWorkspaceContentId(state: WorkspaceContentState, scope: string,
    featureInstanceId?: string, pluginPanelId?: string, featureId?: SplitFeatureId): string | null {
    const activeTerminal = state.activeTerminalIds[scope];
    const layout = resolveWorkspaceCanvas(state.paneLayouts[scope], activeTerminal,
        state.activePaneGroupOwner[scope], featureInstanceId, pluginPanelId, featureId);
    const leaf = layout && collectLeaves(layout.root).find(item => item.id === layout.activePaneId);
    if (leaf) return paneContentKey(leaf.content, leaf.id);
    return !pluginPanelId && !featureId && activeTerminal && state.terminals[scope]?.some(item => item.id === activeTerminal)
        ? paneContentKey({ kind: 'term', termId: activeTerminal }, activeTerminal) : null;
}

/** Keep selection unless hidden; prefer a visible canvas sibling, then saved visual order. */
export function visibleContentFallback(state: WorkspaceContentState, scope: string,
    selectedId: string | null): ContentInventoryItem | undefined {
    const inventory = deriveWorkspaceContentInventory(state.terminals[scope] ?? [], state.paneLayouts[scope]);
    const hidden = hiddenContentIds(inventory, state.contentPresentation?.[scope]);
    const selected = inventory.find(item => item.id === selectedId);
    if (selected && !hidden.has(selected.id)) return selected;
    const visible = sortContentPresentation(inventory, state.contentPresentation?.[scope]).filter(item => !hidden.has(item.id));
    return (selected?.owner ? visible.find(item => item.owner === selected.owner) : undefined) ?? visible[0];
}

/**
 * Implicit shell commands may retain their historical last-shell target, but must
 * never write to a user-hidden instance or one that has already been closed.
 * Explicit addressed backend APIs keep their separate authorization boundary.
 */
export function implicitTerminalTarget(state: WorkspaceContentState, scope: string): string | null {
    const dockId = state.workspaceDockFocus?.[scope];
    if (dockId && state.workspaceDocking?.[scope]?.placements[dockId]) {
        const target = deriveWorkspaceContentInventory(state.terminals[scope] ?? [], state.paneLayouts[scope])
            .find(item => item.id === dockId && isTermContent(item.content));
        if (target && isTermContent(target.content) && !hiddenWorkspaceContent(state, scope).has(dockId)) return target.content.termId;
    }
    const id = state.activeTerminalIds[scope];
    if (!id || !state.terminals[scope]?.some(item => item.id === id)) return null;
    return state.contentPresentation?.[scope]?.items[paneContentKey({ kind: 'term', termId: id }, id)]?.hidden ? null : id;
}

/** Pair immutable resource topology with its geometry projection for action preflight. */
export function workspaceCanvasVisibility(state: WorkspaceContentState, scope: string,
    featureInstanceId?: string, pluginPanelId?: string, featureId?: SplitFeatureId): {
    canonical: PaneLayout | undefined; visible: PaneLayout | null | undefined;
} {
    const activeId = state.activeTerminalIds[scope];
    const canonical = resolveWorkspaceCanvas(state.paneLayouts[scope], activeId, state.activePaneGroupOwner[scope],
        featureInstanceId, pluginPanelId, featureId)
        ?? (!pluginPanelId && !featureId && activeId && state.terminals[scope]?.some(item => item.id === activeId)
            ? singlePane(activeId, activeId) : undefined);
    return { canonical, visible: canonical && projectVisiblePaneLayout(canonical, hiddenWorkspaceContent(state, scope)) };
}
