import { isFeatureContent, isPluginContent, isTermContent } from '../../../lib/paneLayout';
import { deriveWorkspaceContentInventory, findWorkspaceContentPane } from '../domain/contentInventory';
import { hiddenWorkspaceContent, type WorkspaceContentState } from '../domain/visibleContent';
import type { SplitFeatureId } from '../../../lib/paneLayout';

interface ExistingContentState extends WorkspaceContentState {
    focusPane: (scope: string, paneId: string) => void;
    setActiveTerminal: (scope: string, termId: string) => void;
    focusWorkspaceContent?: (scope: string, contentId: string) => boolean;
}

/**
 * Select a fresh, visible canonical identity. This path deliberately has no open,
 * ensure, copy, dock, or close capability, so recovery cannot create resources.
 */
export function selectExistingWorkspaceContent(
    state: ExistingContentState,
    scope: string,
    id: string,
    selectFeatureInstance: (id: string | null) => void,
    selectView: (view: 'terminal' | SplitFeatureId | `plugin:${string}`) => void,
): boolean {
    if (hiddenWorkspaceContent(state, scope).has(id)) return false;
    const item = deriveWorkspaceContentInventory(state.terminals[scope] ?? [], state.paneLayouts[scope]).find(item => item.id === id);
    if (!item) return false;
    if (state.workspaceDocking?.[scope]?.placements[id]) return state.focusWorkspaceContent?.(scope, id) ?? false;
    const located = findWorkspaceContentPane(state.paneLayouts[scope], id);
    if (located) state.focusPane(scope, located.pane.id);
    else if (isTermContent(item.content)) state.setActiveTerminal(scope, item.content.termId);
    else return false;
    if (isFeatureContent(item.content) && item.content.instanceId) {
        selectFeatureInstance(item.content.instanceId);
        selectView(item.content.featureId);
    } else if (isPluginContent(item.content)) {
        selectView(`plugin:${item.content.pluginId}`);
    } else {
        // Legacy features have no modern tab instance; the focused canonical owner
        // selects their canvas through the generic workspace view without migration.
        selectFeatureInstance(null);
        selectView('terminal');
    }
    return true;
}
