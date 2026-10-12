import { useState } from 'react';
import { usePlugins } from '../../../context/PluginContext';
import { useAppStore } from '../../../store/useAppStore';
import { usePluginManagement } from '../../../features/plugins/presentation/usePluginManagement';
import { openBuiltinThemePicker } from '../../../features/plugins/presentation/themePicker';
import { PluginsSidebarContent } from '../../plugins/PluginsSidebarContent';
import { PluginDetailsDialog } from '../../settings/tabs/plugins/PluginDetailsDialog';
import { PluginPermissionReview } from '../../settings/tabs/plugins/PluginsDeveloperTab';

export function PluginsSidebar() {
    const { reloadPlugins, runtimeHealth, retryPluginRuntime } = usePlugins();
    const openSettings = useAppStore(state => state.openSettings);
    const isSettingsOpen = useAppStore(state => state.isSettingsOpen);
    const showToast = useAppStore(state => state.showToast);
    const showConfirmDialog = useAppStore(state => state.showConfirmDialog);
    const manager = usePluginManagement({ enabled: !isSettingsOpen, loadDeveloperOptions: false,
        showToast, showConfirmDialog, reloadPluginRuntime: reloadPlugins });
    const [detailsId, setDetailsId] = useState<string | null>(null);
    const details = manager.plugins.find(plugin => plugin.manifest.id === detailsId);
    const busy = isSettingsOpen || manager.isLoadingPlugins || manager.processingId !== null || manager.isApprovingLocalPlugin;

    return <>
        <PluginsSidebarContent plugins={manager.plugins} registry={manager.selectedRegistry} runtimeHealth={runtimeHealth}
            loadingPlugins={manager.isLoadingPlugins} loadingRegistry={manager.isLoadingRegistry}
            pluginsError={manager.pluginsError} registryError={manager.registryError} busy={busy} needsRestart={manager.needsRestart}
            onOpenSettings={() => openSettings('plugins')} onChooseTheme={() => openBuiltinThemePicker(manager.plugins)}
            onRefresh={manager.refreshPlugins} onDetails={plugin => setDetailsId(plugin.manifest.id)}
            onToggle={plugin => { void manager.handleTogglePlugin(plugin.manifest.id, !plugin.enabled); }}
            onUninstall={plugin => { void manager.handleUninstallPlugin(plugin, false); }}
            onInspect={plugin => { void manager.handleInspectMarketplacePlugin(plugin); }}
            onRetryRuntime={id => { void retryPluginRuntime(id); }} />
        {details && <PluginDetailsDialog standalone plugin={details} health={runtimeHealth.find(item => item.pluginId === detailsId)}
            isProcessing={busy} onClose={() => setDetailsId(null)} onSaveOptionalPermissions={manager.handleSetOptionalPluginPermissions}
            onClearData={manager.handleClearPluginData} onRollback={manager.handleRollbackPlugin} />}
        {manager.pendingPluginInspection && <PluginPermissionReview standalone key={manager.pendingPluginInspection.inspectionId}
            inspection={manager.pendingPluginInspection} isApproving={manager.isApprovingLocalPlugin}
            onApprove={manager.handleApproveLocalPlugin} onCancel={manager.handleCancelLocalPluginReview} />}
    </>;
}
