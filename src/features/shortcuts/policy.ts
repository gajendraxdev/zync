import type { KeyboardFocus, ShortcutWhen } from './types';

/**
 * Whether app commands may intercept a focused terminal's keys.
 * Only host clipboard utilities and explicitly reserved commands bypass shell-first.
 */
export type TerminalFocusShortcutPolicy = 'shell' | 'app';

export const DEFAULT_TERMINAL_FOCUS_SHORTCUT_POLICY: TerminalFocusShortcutPolicy = 'shell';

const POLICIES = new Set<TerminalFocusShortcutPolicy>(['shell', 'app']);

export function normalizeTerminalFocusPolicy(value: unknown): TerminalFocusShortcutPolicy {
    if (typeof value === 'string' && POLICIES.has(value as TerminalFocusShortcutPolicy)) {
        return value as TerminalFocusShortcutPolicy;
    }
    return DEFAULT_TERMINAL_FOCUS_SHORTCUT_POLICY;
}

export type KeyboardSettings = {
    terminalFocusPolicy: TerminalFocusShortcutPolicy;
    /** Named app commands allowed in shell-first; an empty list disables all app exceptions. */
    terminalShortcutExceptions: string[];
};

/** Deliberately small allowlist, not a blanket Ctrl+Shift rule. */
export const TERMINAL_SHORTCUT_EXCEPTION_IDS = [
    'commandPaletteMode', 'snippetsFeature', 'filesFeature', 'tunnelsFeature', 'dashboardFeature',
] as const;
export const DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS: readonly string[] = ['commandPaletteMode', 'snippetsFeature'];

/** Ignore unknown IDs, preserve explicit empty choices, and provide upgrade defaults. */
export function normalizeTerminalShortcutExceptions(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [...DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS];
    return TERMINAL_SHORTCUT_EXCEPTION_IDS.filter(id => raw.includes(id));
}

export const DEFAULT_KEYBOARD_SETTINGS: KeyboardSettings = {
    terminalFocusPolicy: DEFAULT_TERMINAL_FOCUS_SHORTCUT_POLICY,
    terminalShortcutExceptions: [...DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS],
};

export function normalizeKeyboardSettings(raw: unknown): KeyboardSettings {
    const source = raw && typeof raw === 'object' ? (raw as Partial<KeyboardSettings>) : {};
    return {
        terminalFocusPolicy: normalizeTerminalFocusPolicy(source.terminalFocusPolicy),
        terminalShortcutExceptions: normalizeTerminalShortcutExceptions(source.terminalShortcutExceptions),
    };
}

/**
 * Focus scope and terminal ownership are independent. `always` is not a
 * terminal-first bypass. File/editor-local handlers keep their own scope.
 * PTY mappings are not gated here — they run in xterm if the dispatcher did not consume the event.
 */
export function allowsWhen(
    when: ShortcutWhen,
    focus: KeyboardFocus,
    policy: TerminalFocusShortcutPolicy = DEFAULT_TERMINAL_FOCUS_SHORTCUT_POLICY,
    terminalException = false,
): boolean {
    if (focus === 'xterm' && policy === 'shell' && !terminalException) return false;
    switch (when) {
        case 'always':
            return true;
        case 'xterm':
            return focus === 'xterm';
        case 'app':
            if (focus === 'app') return true;
            if (focus === 'xterm' && policy === 'app') return true;
            return false;
        case 'field':
            return false;
        case 'files':
            return false;
        default:
            return false;
    }
}
