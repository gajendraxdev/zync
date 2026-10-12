import { useEffect, useRef } from 'react';
import { layoutForPlugin, type PaneLayoutGroups } from '../../lib/paneLayout';

interface PluginPaneNavigationState {
    paneLayouts: Record<string, PaneLayoutGroups | undefined>;
    activePaneGroupOwner: Record<string, string | null>;
    ensurePluginPane: (connectionId: string, panelId: string) => void;
    activatePaneGroup: (connectionId: string, owner: string) => void;
}

/** Kind-level routing is an open request, never a second inventory of live instances. */
export function usePluginPaneNavigation({ connectionId, view, pinnedFeatures, isActive, groups, getState, onMissingView }: {
    connectionId?: string;
    view: string;
    pinnedFeatures: readonly string[];
    isActive: boolean;
    groups: PaneLayoutGroups | undefined;
    getState: () => PluginPaneNavigationState;
    onMissingView: () => void;
}) {
    const previous = useRef<{ connectionId: string; view: string; pins: Set<string> } | undefined>(undefined);
    useEffect(() => {
        if (!connectionId) { previous.current = undefined; return; }
        const prior = previous.current;
        const changedScope = prior?.connectionId !== connectionId;
        const requests = pinnedFeatures.filter(item => changedScope || !prior?.pins.has(item));
        if (changedScope || prior?.view !== view) requests.push(view);
        previous.current = { connectionId, view, pins: new Set(pinnedFeatures) };
        for (const request of new Set(requests)) {
            if (request.startsWith('plugin:') && request.length > 'plugin:'.length) {
                getState().ensurePluginPane(connectionId, request.slice('plugin:'.length));
            }
        }
        if (!isActive || !view.startsWith('plugin:')) return;
        const state = getState();
        const currentGroups = state.paneLayouts[connectionId];
        const layout = layoutForPlugin(currentGroups, view.slice('plugin:'.length), state.activePaneGroupOwner[connectionId]);
        const owner = Object.entries(currentGroups ?? {}).find(([, candidate]) => candidate === layout)?.[0];
        if (!owner) onMissingView();
        else if (state.activePaneGroupOwner[connectionId] !== owner) state.activatePaneGroup(connectionId, owner);
    }, [connectionId, getState, groups, isActive, onMissingView, pinnedFeatures, view]);
}
