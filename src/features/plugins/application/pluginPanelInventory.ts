export interface PluginPanelInventoryItem {
    id: string;
    title: string;
    allowMultiple: boolean;
    pluginId?: string;
}

/** Installed pane definitions survive worker reloads; runtime HTML never enters this inventory. */
export function stablePluginPanelInventory(
    active: readonly { id: string; title: string; allowMultiple?: boolean; pluginId?: string }[],
    installed: readonly { manifest: { id: string; contributes?: { paneKinds?: readonly { id: string; title: string; allowMultiple?: boolean }[] } } }[],
): PluginPanelInventoryItem[] {
    const panels = new Map<string, PluginPanelInventoryItem>(active.map(panel => [panel.id, {
        id: panel.id, title: panel.title, allowMultiple: panel.allowMultiple === true,
        ...(panel.pluginId ? { pluginId: panel.pluginId } : {}),
    }]));
    for (const plugin of installed) {
        for (const pane of plugin.manifest.contributes?.paneKinds ?? []) {
            const id = `${plugin.manifest.id}:${pane.id}`;
            const existing = panels.get(id);
            if (!existing) panels.set(id, { id, title: pane.title, allowMultiple: pane.allowMultiple === true, pluginId: plugin.manifest.id });
            else if (!existing.pluginId) panels.set(id, { ...existing, pluginId: plugin.manifest.id });
        }
    }
    return [...panels.values()];
}
