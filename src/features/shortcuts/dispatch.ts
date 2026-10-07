import { defaultSettings } from '../../store/settingsSlice';
import { useAppStore } from '../../store/useAppStore';
import { runShortcutCommand } from './actions';
import { SHORTCUT_CATALOG } from './catalog';
import { keyboardEventFocus, ownsLocalKeyboard } from './focus';
import { normalizeKeyboardSettings } from './policy';
import { routeShortcut } from './route';

/**
 * If a Zync command owns this event, run it and return true (caller should preventDefault).
 * PTY mappings are handled in the xterm key handler, not here.
 */
export function dispatchAppShortcut(event: KeyboardEvent): boolean {
    if (ownsLocalKeyboard(event)) return false;
    const settings = useAppStore.getState().settings;
    const focus = keyboardEventFocus(event);
    const keyboard = normalizeKeyboardSettings(settings.keyboard);
    return routeShortcut(event, focus, keyboard.terminalFocusPolicy, SHORTCUT_CATALOG,
        settings.keybindings ?? defaultSettings.keybindings, runShortcutCommand, keyboard.terminalShortcutExceptions);
}
