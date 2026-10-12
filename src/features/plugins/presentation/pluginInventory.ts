import type { InstalledPlugin, RegistryPlugin } from '../types';
import { isTrustedBuiltinTheme } from '../pluginCommandBridge';
import { compareVersion } from '../marketplace/releases';

/** Group only app-owned themes; third-party packages retain their own identity/actions. */
export function groupInstalledPlugins(plugins: InstalledPlugin[]) {
    return {
        themes: plugins.filter(plugin => isTrustedBuiltinTheme(plugin) && plugin.manifest.id !== 'com.zync.theme.manager'),
        plugins: plugins.filter(plugin => !isTrustedBuiltinTheme(plugin) && plugin.manifest.id !== 'com.zync.theme.manager'),
    };
}

export function availablePluginUpdate(plugin: InstalledPlugin, releases: RegistryPlugin[]) {
    return releases.find(release => release.id === plugin.manifest.id
        && release.registryVerified && !release.revokedReason
        && compareVersion(release.version, plugin.manifest.version) > 0);
}

export function canInstallMarketplacePlugin(plugin: RegistryPlugin): boolean {
    return plugin.registryVerified === true && !plugin.revokedReason;
}
