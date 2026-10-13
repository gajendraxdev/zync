import type { Tab } from '../../connections/domain/types';
import { collectLeaves, isSplitFeatureId, isTermContent } from '../../../lib/paneLayout';
import { workspaceDockingView, type WorkspaceDockingState } from '../domain/dockingView';

interface ReconnectWorkspaceState extends WorkspaceDockingState {
    tabs: readonly Tab[];
    activeTabId: string | null;
}

/**
 * Select an actually visible shell to receive the first reconnect channel before
 * SFTP consumes the host's one-shot login banner. Use the renderer's allocation,
 * including persistent docks beside feature/plugin views; never wake a hidden or
 * background shell just to wait for it. This does not create, select or spawn it.
 */
export function terminalForConnectionStartup(
    state: ReconnectWorkspaceState, scope: string, preferredTermId: string | null,
): string | null {
    const tab = state.tabs.find(item => item.id === state.activeTabId);
    if (tab?.type !== 'connection' || tab.connectionId !== scope) return null;
    const { projection } = workspaceDockingView(state, scope, {
        featureId: isSplitFeatureId(tab.view) ? tab.view : undefined,
        pluginPanelId: tab.view.startsWith('plugin:') ? tab.view.slice('plugin:'.length) : undefined,
    });
    if (!projection.ok) return null;
    const live = new Set((state.terminals[scope] ?? []).map(item => item.id));
    const terminals = Object.values(projection.value.regions).flatMap(allocations => allocations.flatMap(({ layout }) =>
        collectLeaves(layout.root).flatMap(leaf => isTermContent(leaf.content) && live.has(leaf.content.termId)
            ? [leaf.content.termId] : [])));
    return preferredTermId && terminals.includes(preferredTermId) ? preferredTermId : terminals[0] ?? null;
}
