import { useId, useState } from 'react';
import { Palette, RefreshCw, Settings } from 'lucide-react';
import type { InstalledPlugin, RegistryPlugin } from '../../features/plugins/types';
import { availablePluginUpdate, canInstallMarketplacePlugin, groupInstalledPlugins } from '../../features/plugins/presentation/pluginInventory';
import type { PluginRuntimeHealth } from '../../features/plugins/runtime/pluginRuntimeSupervisor';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Input } from '../ui/Input';
import { Tooltip } from '../ui/Tooltip';
import { StateMessage } from '../ui/StateMessage';
import type { ContextMenuItem } from '../ui/ContextMenu';
import { CONTROL_INSET_FOCUS_CLASSES } from '../ui/controlStyles';
import { SegmentedControl } from '../settings/common/SegmentedControl';
import { IconResolver } from '../settings/common/IconResolver';
import { SidebarActionButton } from '../layout/sidebar/SidebarActionButton';
import { PluginSidebarItem } from './PluginSidebarItem';

export interface PluginSidebarActions {
    onOpenSettings(): void;
    onChooseTheme(): void;
    onRefresh(): void;
    onDetails(plugin: InstalledPlugin): void;
    onToggle(plugin: InstalledPlugin): void;
    onUninstall(plugin: InstalledPlugin): void;
    onInspect(plugin: RegistryPlugin): void;
    onRetryRuntime(id: string): void;
}

export interface PluginsSidebarContentProps extends PluginSidebarActions {
    plugins: InstalledPlugin[];
    registry: RegistryPlugin[];
    loadingPlugins: boolean;
    loadingRegistry: boolean;
    pluginsError?: string | null;
    registryError?: string | null;
    runtimeHealth: PluginRuntimeHealth[];
    busy: boolean;
    needsRestart: boolean;
}

/** Both views delegate mutations to the same reviewed management controller as Settings. */
export function installedPluginActions(plugin: InstalledPlugin, update: RegistryPlugin | undefined,
    health: PluginRuntimeHealth | undefined, actions: PluginSidebarActions): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
        { label: 'Details and permissions', action: () => actions.onDetails(plugin) },
        { label: plugin.enabled ? 'Disable' : 'Enable', action: () => actions.onToggle(plugin) },
    ];
    if (update) items.push({ label: `Update to ${update.version}`, action: () => actions.onInspect(update) });
    if (health?.status === 'crashed' || health?.status === 'quarantined') {
        items.push({ label: 'Retry runtime', action: () => actions.onRetryRuntime(plugin.manifest.id) });
    }
    if (!plugin.path.startsWith('builtin://')) {
        items.push({ separator: true }, { label: 'Uninstall', variant: 'danger', action: () => actions.onUninstall(plugin) });
    }
    return items;
}

type Section = 'installed' | 'marketplace';
const SECTIONS = [{ key: 'installed', label: 'Installed' }, { key: 'marketplace', label: 'Marketplace' }] as const;

export function PluginsSidebarContent(props: PluginsSidebarContentProps) {
    const [section, setSection] = useState<Section>('installed');
    const [query, setQuery] = useState('');
    const prefix = useId();
    const grouped = groupInstalledPlugins(props.plugins);
    const search = query.trim().toLowerCase();
    const matches = (name: string, id: string, description = '') => [name, id, description]
        .some(value => value.toLowerCase().includes(search));
    const installed = grouped.plugins.filter(({ manifest }) => matches(manifest.name, manifest.id, manifest.description));
    const themesVisible = grouped.themes.length > 0 && (matches('Zync Built-in Themes', 'themes')
        || grouped.themes.some(({ manifest }) => matches(manifest.name, manifest.id)));
    const marketplace = props.registry.filter(plugin => matches(plugin.name, plugin.id, plugin.description));
    const loading = section === 'installed' ? props.loadingPlugins : props.loadingRegistry;
    const error = section === 'installed' ? props.pluginsError : props.registryError;
    const empty = section === 'installed' ? !installed.length && !themesVisible : !marketplace.length;

    return <section aria-label="Plugins" className="flex flex-1 min-h-0 flex-col text-app-text">
        <div className="px-3 pt-3 pb-2 space-y-3 shrink-0">
            <div className="flex items-center justify-between gap-2">
                <h2 className="text-xs font-semibold">Plugins</h2>
                <Tooltip content="Refresh plugins">
                    <IconButton label="Refresh plugins" icon={<RefreshCw size={13} />} disabled={props.busy || loading}
                        onClick={props.onRefresh} className={`h-6 w-6 ${CONTROL_INSET_FOCUS_CLASSES}`} />
                </Tooltip>
            </div>
            <SegmentedControl options={SECTIONS} value={section} onChange={setSection} ariaLabel="Plugin sidebar sections" idPrefix={prefix} />
            <Input aria-label={`Search ${section === 'installed' ? 'installed plugins' : 'marketplace'}`}
                placeholder={section === 'installed' ? 'Search installed plugins' : 'Search marketplace'} value={query}
                onChange={event => setQuery(event.target.value)} />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3" role="tabpanel"
            id={`${prefix}-panel-${section}`} aria-labelledby={`${prefix}-tab-${section}`} aria-busy={loading}>
            {props.needsRestart && <StateMessage variant="status" className="text-xs py-2">Restart Zync to finish applying plugin changes.</StateMessage>}
            {loading ? <StateMessage variant="status" className="text-xs py-3">Loading {section === 'installed' ? 'plugins' : 'marketplace'}…</StateMessage>
                : error ? <StateMessage variant="error" className="text-xs py-3">{error}</StateMessage>
                    : empty ? <StateMessage variant="empty" className="text-xs py-3">{search ? 'No matching plugins.'
                        : section === 'installed' ? 'No plugins installed.' : 'No marketplace plugins available.'}</StateMessage>
                        : <ul aria-label={section === 'installed' ? 'Installed plugins' : 'Marketplace plugins'} className="divide-y divide-app-border/30">
                            {section === 'installed' && themesVisible && <PluginSidebarItem name="Zync Built-in Themes"
                                description={`${grouped.themes.length} built-in themes, managed together.`} icon={<Palette size={20} />}
                                trailing={<Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onChooseTheme}>Choose theme</Button>} />}
                            {section === 'installed' ? installed.map(plugin => {
                                const update = availablePluginUpdate(plugin, props.registry);
                                const health = props.runtimeHealth.find(item => item.pluginId === plugin.manifest.id);
                                return <PluginSidebarItem key={plugin.manifest.id} name={plugin.manifest.name}
                                    description={plugin.manifest.description} version={plugin.manifest.version}
                                    status={`${plugin.enabled ? 'Enabled' : 'Disabled'}${update ? ' · Update available' : ''}`}
                                    icon={<IconResolver name={plugin.manifest.icon} path={plugin.path} size={20} />}
                                    disabled={props.busy} actions={installedPluginActions(plugin, update, health, props)} />;
                            }) : marketplace.map(plugin => {
                                const local = props.plugins.find(item => item.manifest.id === plugin.id);
                                const update = local && availablePluginUpdate(local, [plugin]);
                                const allowed = canInstallMarketplacePlugin(plugin);
                                return <PluginSidebarItem key={plugin.id} name={plugin.name} description={plugin.description} version={plugin.version}
                                    status={plugin.revokedReason ? 'Revoked' : !allowed ? 'Unverified catalog entry' : local ? 'Installed' : 'Signed package'}
                                    icon={<IconResolver name={plugin.icon} size={20} />} disabled={props.busy}
                                    actions={local ? installedPluginActions(local, update, undefined, props) : undefined}
                                    trailing={!local || update ? <Button size="sm" variant="secondary" disabled={props.busy || !allowed}
                                        onClick={() => props.onInspect(plugin)}>{local ? 'Review update' : 'Review & install'}</Button> : undefined} />;
                            })}
                        </ul>}
        </div>
        <div className="border-t border-app-border/50 p-3 shrink-0">
            <SidebarActionButton icon={<Settings size={13} />} label="Plugin settings" disabled={props.busy} onClick={props.onOpenSettings} />
            <p className="text-[10px] text-app-muted mt-2">Developer options and advanced settings</p>
        </div>
    </section>;
}
