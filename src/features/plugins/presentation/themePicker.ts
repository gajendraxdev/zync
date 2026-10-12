import { getBuiltinThemeChoices } from '../pluginCommandBridge';
import type { InstalledPlugin } from '../types';

/** Host-owned picker shared by plugin management and the command palette; no Worker is required. */
export function openBuiltinThemePicker(plugins: InstalledPlugin[]): void {
    window.dispatchEvent(new CustomEvent('zync:quick-pick', {
        detail: {
            items: getBuiltinThemeChoices(plugins.filter(plugin => plugin.enabled)),
            options: { placeHolder: 'Select Color Theme' },
            requestId: 'color-theme-select',
            pluginId: 'system',
        },
    }));
}
