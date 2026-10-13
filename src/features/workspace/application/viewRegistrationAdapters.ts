import { stablePluginPanelInventory } from '../../plugins/application/pluginPanelInventory';
import { PANE_REGIONS } from '../../../lib/paneLayout/regions';
import {
    BUILTIN_WORKSPACE_VIEW_REGISTRATIONS,
    buildWorkspaceViewRegistry,
    pluginWorkspaceViewId,
    type WorkspaceViewRegistry,
} from '../domain/registrations';

/**
 * Compose metadata from host-owned plugin contributions, retaining installed declarations
 * while a worker reloads. This neither activates plugins nor grants their capabilities;
 * the native broker still owns authorization. Invalid metadata is reported by the parser.
 */
export function buildWorkspaceViewRegistrations(
    activePanels: Parameters<typeof stablePluginPanelInventory>[0] = [],
    installedPlugins: Parameters<typeof stablePluginPanelInventory>[1] = [],
): WorkspaceViewRegistry {
    return buildWorkspaceViewRegistry([
        ...BUILTIN_WORKSPACE_VIEW_REGISTRATIONS,
        ...stablePluginPanelInventory(activePanels, installedPlugins).map(panel => ({
            id: pluginWorkspaceViewId(panel.pluginId, panel.id),
            source: { kind: 'plugin', pluginId: panel.pluginId, panelId: panel.id },
            label: panel.title,
            allowedLocations: PANE_REGIONS,
            multiplicity: panel.allowMultiple ? 'multiple' : 'single',
            capabilities: ['rename', 'reorder', 'pin', 'hide'],
        })),
    ]);
}

// Compatibility export: pure identity resolution belongs to the domain, not plugin composition.
export { registrationForContent } from '../domain/registrations';
