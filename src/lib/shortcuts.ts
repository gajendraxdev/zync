/** US Shift+digit `KeyboardEvent.key` values (`Mod+Shift+1` → `!`). */
const US_SHIFT_DIGIT_KEY: Record<string, string> = {
    '1': '!',
    '2': '@',
    '3': '#',
    '4': '$',
    '5': '%',
    '6': '^',
    '7': '&',
    '8': '*',
    '9': '(',
    '0': ')',
};

/** True when the event's key/code matches the binding token (Shift+digit uses `!` / `@` or `DigitN`). */
export function shortcutMainKeyMatches(
    event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey'>,
    token: string,
    shiftRequired: boolean,
): boolean {
    const want = token.toLowerCase();
    if (event.key.toLowerCase() === want) return true;
    if (want === 'tab' && event.key === 'Tab') return true;
    if (shiftRequired && /^[0-9]$/.test(want)) {
        if (event.key === US_SHIFT_DIGIT_KEY[want]) return true;
        if (event.code === `Digit${want}`) return true;
    }
    return false;
}

/**
 * Helper to check if a KeyboardEvent matches a shortcut string like "Mod+Shift+T" or "Ctrl+B".
 * "Mod" translates to Command on macOS and Ctrl on Windows/Linux.
 */
export function matchShortcut(e: KeyboardEvent, shortcut: string): boolean {
    if (!shortcut) return false;
    const parts = shortcut.toLowerCase().split('+');
    let key = parts[parts.length - 1];
    if (key === 'plus') key = '+';

    // Check modifiers
    const hasCtrl = parts.includes('ctrl') || parts.includes('control');
    const hasShift = parts.includes('shift');
    const hasAlt = parts.includes('alt');
    const hasMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command') || parts.includes('super');
    const hasMod = parts.includes('mod'); // Ctrl on Win/Linux, Meta on Mac

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const effectiveCtrl = hasCtrl || (hasMod && !isMac);
    const effectiveMeta = hasMeta || (hasMod && isMac);

    if (e.ctrlKey !== effectiveCtrl) return false;
    if (e.metaKey !== effectiveMeta) return false;
    if (e.altKey !== hasAlt) return false;
    if (e.shiftKey !== hasShift) return false;

    return shortcutMainKeyMatches(e, key, hasShift);
}

/** True when key events target xterm's focused helper textarea (or an element inside `.xterm`). */
export function isXtermKeyboardTarget(target: EventTarget | null | undefined): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.classList.contains('xterm-helper-textarea')) return true;
    return Boolean(target.closest('.xterm'));
}

/**
 * Human-readable shortcut for tooltips (e.g. `Mod+B` → `Ctrl+B` / `⌘B`).
 */
export function formatShortcutLabel(shortcut: string, isMac?: boolean): string {
    if (!shortcut?.trim()) return '';
    const mac = isMac
        ?? (typeof navigator !== 'undefined' && /mac/i.test(navigator.platform));
    return shortcut
        .split('+')
        .map((part) => {
            const p = part.trim();
            const lower = p.toLowerCase();
            if (lower === 'mod') return mac ? '⌘' : 'Ctrl';
            if (lower === 'meta' || lower === 'cmd' || lower === 'command') return mac ? '⌘' : 'Win';
            if (lower === 'ctrl' || lower === 'control') return mac ? '⌃' : 'Ctrl';
            if (lower === 'alt' || lower === 'option') return mac ? '⌥' : 'Alt';
            if (lower === 'shift') return mac ? '⇧' : 'Shift';
            if (lower === 'plus') return '+';
            if (lower === 'arrowright') return 'Right';
            if (lower === 'arrowleft') return 'Left';
            if (lower === 'arrowup') return 'Up';
            if (lower === 'arrowdown') return 'Down';
            if (p.length === 1) return p.toUpperCase();
            return p;
        })
        .join(mac ? '' : '+');
}
