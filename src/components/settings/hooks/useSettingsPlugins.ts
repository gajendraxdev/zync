import { usePluginManagement, type PluginManagementOptions } from '../../../features/plugins/presentation/usePluginManagement';

export type { InstalledPlugin, RegistryPlugin, ConfirmDialogOptions } from '../../../features/plugins/presentation/usePluginManagement';

interface UseSettingsPluginsOptions extends Omit<PluginManagementOptions, 'enabled' | 'appearanceOnly' | 'loadDeveloperOptions'> {
    isOpen: boolean;
    activeTab: string;
}

/** Settings adapter; plugin management is shared with the global Plugins sidebar. */
export function useSettingsPlugins({ isOpen, activeTab, ...ports }: UseSettingsPluginsOptions) {
    return usePluginManagement({
        ...ports,
        enabled: isOpen && (activeTab === 'plugins' || activeTab === 'appearance'),
        appearanceOnly: activeTab === 'appearance',
    });
}
