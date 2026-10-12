import { formatShortcutLabel } from '../../lib/shortcuts';
import { SHORTCUT_CATALOG } from './catalog';
import { shortcutBindings } from './bindings';

/** Tooltip hints use the same catalog and current overrides as keyboard routing. */
export function shortcutHint(commandId: string, overrides: Readonly<Record<string, string | undefined>>): string | undefined {
    const command = SHORTCUT_CATALOG.find(item => item.id === commandId);
    const keys = [command, ...SHORTCUT_CATALOG.filter(item => item.actionId === commandId)]
        .flatMap(item => item ? shortcutBindings(item, overrides).slice(0, 1) : []);
    return keys.length ? keys.map(key => formatShortcutLabel(key)).join(' / ') : undefined;
}
