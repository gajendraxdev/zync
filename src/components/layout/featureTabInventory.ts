import {
    collectLeaves,
    isFeatureContent,
    isSplitFeatureId,
    type PaneLayout,
    type PaneLayoutGroups,
    type SplitFeatureId,
} from '../../lib/paneLayout';
import type { WorkspaceFeatureTab } from './featureMeta';

export { stablePluginPanelInventory } from '../../features/plugins/application/pluginPanelInventory';

/** Pinned and restored active plugins must not depend on a mount-local open list. */
export function pluginTabInventory(openFeatures: string[], pinnedFeatures: string[], activeView: string): string[] {
    return [...new Set([...openFeatures, ...pinnedFeatures, activeView])]
        .filter(view => view.startsWith('plugin:') && view.length > 'plugin:'.length);
}

/** Feature panes already stored for a host. One tab per instance id. */
export function featureTabsFromPaneGroups(
    groups: PaneLayoutGroups | null | undefined,
): WorkspaceFeatureTab[] {
    const tabs: WorkspaceFeatureTab[] = [];
    const seen = new Set<string>();
    for (const layout of Object.values(groups ?? {})) {
        for (const leaf of collectLeaves(layout.root)) {
            if (!isFeatureContent(leaf.content) || !leaf.content.instanceId) continue;
            if (!isSplitFeatureId(leaf.content.featureId)) continue;
            if (seen.has(leaf.content.instanceId)) continue;
            seen.add(leaf.content.instanceId);
            tabs.push({
                id: leaf.content.instanceId,
                featureId: leaf.content.featureId,
                instanceId: leaf.content.instanceId,
            });
        }
    }
    return tabs;
}

function layoutHasFeatureInstance(layout: PaneLayout, instanceId: string): boolean {
    return collectLeaves(layout.root).some(leaf => (
        isFeatureContent(leaf.content) && leaf.content.instanceId === instanceId
    ));
}

/**
 * The tab inside the active pane group, otherwise the latest tab of that feature.
 * `activeOwner` is the group key (a shell id, a feature instance, or "workspace"),
 * not the feature instance id nested inside that group.
 */
export function preferredFeatureTabId(
    tabs: readonly WorkspaceFeatureTab[],
    featureId: SplitFeatureId,
    groups: PaneLayoutGroups | null | undefined,
    activeOwner: string | null | undefined,
): string | null {
    const matching = tabs.filter(tab => tab.featureId === featureId);
    const activeLayout = activeOwner ? groups?.[activeOwner] : undefined;
    const owned = activeLayout
        ? matching.find(tab => layoutHasFeatureInstance(activeLayout, tab.instanceId))
        : undefined;
    return owned?.id ?? matching[matching.length - 1]?.id ?? null;
}
