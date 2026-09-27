import { usePlugins } from '../../context/PluginContext';
import { resolvePluginPanelOwner } from '../../features/plugins/pluginPanelOwner';
import { PluginAssetIcon } from './PluginAssetIcon';

export function PluginIcon({ panelId, size = 14, className }: { panelId: string; size?: number; className?: string }) {
    const { panels, plugins } = usePlugins();
    const pluginId = resolvePluginPanelOwner(panelId, panels, plugins);
    const plugin = plugins.find(candidate => candidate.manifest.id === pluginId);
    return <PluginAssetIcon icon={plugin?.manifest.icon} pluginPath={plugin?.path} size={size} className={className} />;
}
