import { useEffect, useRef } from 'react';
import { collectLeaves, isFeatureContent, isSplitFeatureId, type PaneLayoutGroups, type SplitFeatureId } from '../../lib/paneLayout';
import { featureTabsFromPaneGroups, preferredFeatureTabId } from './featureTabInventory';

interface FeatureNavigationState {
    paneLayouts: Record<string, PaneLayoutGroups | undefined>;
    activePaneGroupOwner: Record<string, string | null>;
    ensureFeaturePane: (scope: string, feature: SplitFeatureId, instanceId: string) => void;
}

/**
 * Enroll only new navigation/pin intents. Canonical panes own the open inventory:
 * closing one must not let a stale mount-local descriptor recreate its resource.
 * Hidden and legacy instances count as existing content, not an invitation to open.
 */
export function useFeaturePaneNavigation({ connectionId, view, pinnedFeatures, isActive, groups,
    activeInstanceId, getState, createInstanceId, onSelectInstance, onMissingView }: {
    connectionId?: string;
    view: string;
    pinnedFeatures: readonly string[];
    isActive: boolean;
    groups: PaneLayoutGroups | undefined;
    activeInstanceId: string | null;
    getState: () => FeatureNavigationState;
    createInstanceId: () => string;
    onSelectInstance: (id: string | null) => void;
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
        const hasFeature = (feature: SplitFeatureId) => Object.values(getState().paneLayouts[connectionId] ?? {})
            .some(layout => collectLeaves(layout.root).some(leaf => isFeatureContent(leaf.content) && leaf.content.featureId === feature));
        for (const request of new Set(requests)) {
            if (!isSplitFeatureId(request) || hasFeature(request)) continue;
            const instance = pinnedFeatures.includes(request) ? `pinned:${request}` : createInstanceId();
            getState().ensureFeaturePane(connectionId, request, instance);
        }
        if (!isActive || !isSplitFeatureId(view)) return;
        const state = getState();
        const currentGroups = state.paneLayouts[connectionId];
        const tabs = featureTabsFromPaneGroups(currentGroups);
        const existing = tabs.find(item => item.id === activeInstanceId && item.featureId === view);
        const next = existing?.id ?? preferredFeatureTabId(tabs, view, currentGroups, state.activePaneGroupOwner[connectionId]);
        if (activeInstanceId !== next) onSelectInstance(next);
        if (!next && !hasFeature(view)) onMissingView();
    }, [activeInstanceId, connectionId, createInstanceId, getState, groups, isActive, onMissingView, onSelectInstance, pinnedFeatures, view]);
}
