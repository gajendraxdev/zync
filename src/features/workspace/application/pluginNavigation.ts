import type { AppStore } from '../../../store/useAppStore';
import { deriveWorkspaceContentInventory } from '../domain/contentInventory';
import { workspaceCanvases } from '../domain/canvases';
import { parseWorkspaceDocking, workspaceDockingCapacity } from '../domain/docking';
import { hiddenWorkspaceContent } from '../domain/visibleContent';
import { pluginNavigationViews } from '../domain/registrations';

type PluginNavigationState = Pick<AppStore, 'tabs' | 'activeTabId' | 'activeConnectionId' | 'showWelcomeScreen'
    | 'sessionLoaded' | 'isRestoring' | 'sessionPersistenceBlocked' | 'workspaceViewRegistry'
    | 'terminals' | 'paneLayouts' | 'activePaneGroupOwner' | 'activeTerminalIds' | 'workspaceDocking'
    | 'workspaceDockFocus' | 'contentPresentation' | 'ensurePluginPane' | 'setContentHidden'
    | 'focusWorkspaceContent' | 'setTabView'>;

function context(state: PluginNavigationState, viewId: string) {
    const tab = state.tabs.find(item => item.id === state.activeTabId);
    const view = pluginNavigationViews(state.workspaceViewRegistry).find(item => item.id === viewId);
    if (!state.sessionLoaded || state.isRestoring || state.sessionPersistenceBlocked || state.showWelcomeScreen
        || tab?.type !== 'connection' || !tab.connectionId || tab.connectionId !== state.activeConnectionId
        || view?.source.kind !== 'plugin') return null;
    const parsed = parseWorkspaceDocking(state.workspaceDocking);
    const canvases = workspaceCanvases(state.terminals[tab.connectionId] ?? [], state.paneLayouts[tab.connectionId]);
    if (!parsed.ok || new Set(canvases.map(canvas => canvas.owner)).size !== canvases.length
        || !workspaceDockingCapacity(canvases.map(canvas => canvas.layout),
            new Map(Object.entries(parsed.value[tab.connectionId]?.placements ?? {}))).ok) return null;
    return { tab, scope: tab.connectionId, panelId: view.source.panelId, preferences: parsed.value[tab.connectionId] };
}

/**
 * Explicit host click: focus an existing pane (prefer the current instance), reveal
 * only when every matching instance is hidden, or use the established ensure path.
 * No worker activation, permission changes, pane moves or duplicate resources.
 */
export function activatePluginNavigation(get: () => PluginNavigationState, viewId: string): boolean {
    let state = get();
    const origin = context(state, viewId);
    if (!origin) return false;
    const stillCurrent = (current: ReturnType<typeof context>) => current?.tab.id === origin.tab.id && current.scope === origin.scope;
    const matches = (current: PluginNavigationState) => deriveWorkspaceContentInventory(
        current.terminals[origin.scope] ?? [], current.paneLayouts[origin.scope])
        .filter(item => item.content.kind === 'plugin' && item.content.pluginId === origin.panelId);
    let candidates = matches(state);
    if (!candidates.length) {
        if (!state.ensurePluginPane(origin.scope, origin.panelId)) return false;
        state = get();
        if (!stillCurrent(context(state, viewId))) return false;
        candidates = matches(state);
    }
    const hidden = hiddenWorkspaceContent(state, origin.scope);
    const visible = candidates.filter(item => !hidden.has(item.id));
    const eligible = visible.length ? visible : candidates;
    const selected = eligible.find(item => item.id === state.workspaceDockFocus[origin.scope])
        ?? eligible.find(item => item.owner && item.owner === state.activePaneGroupOwner[origin.scope]
            && item.paneId === state.paneLayouts[origin.scope]?.[item.owner]?.activePaneId)
        ?? eligible[0];
    if (!selected || (hidden.has(selected.id) && !state.setContentHidden(origin.scope, selected.id, false))) return false;
    state = get();
    const current = context(state, viewId);
    if (!stillCurrent(current) || !state.focusWorkspaceContent(origin.scope, selected.id)) return false;
    const focused = context(get(), viewId);
    if (!stillCurrent(focused)) return false;
    if (!focused?.preferences?.placements[selected.id]) get().setTabView(origin.tab.id, `plugin:${origin.panelId}`);
    return true;
}
