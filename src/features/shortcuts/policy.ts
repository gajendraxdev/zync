import type { KeyboardFocus, ShortcutWhen } from './types';
import { SHORTCUT_CATALOG } from './catalog';

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
    /** Marks adoption of independent secondary bindings; preserves subsequent opt-outs. */
    secondaryShortcutsVersion?: number;
};

/** Eligibility and upgrade defaults derive from the same catalog as dispatch and UI. */
export const TERMINAL_SHORTCUT_EXCEPTION_IDS: readonly string[] = SHORTCUT_CATALOG
    .filter(command => command.terminalReservation).map(command => command.id);
export const DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS: readonly string[] = SHORTCUT_CATALOG
    .filter(command => command.terminalReservation === 'default').map(command => command.id);

/** Explicit opt-in preset; never silently broadens existing terminal ownership. */
export const RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS: readonly string[] = SHORTCUT_CATALOG
    .filter(command => command.terminalReservation === 'default' || command.terminalReservation === 'recommended')
    .map(command => command.id);

const SECONDARY_SHORTCUTS_VERSION = 1;
const SECONDARY_SHORTCUT_IDS = SHORTCUT_CATALOG.filter(command => command.actionId && command.terminalReservation)
    .map(command => command.id);

/** Ignore unknown IDs, preserve explicit empty choices, and provide upgrade defaults. */
export function normalizeTerminalShortcutExceptions(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [...DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS];
    return TERMINAL_SHORTCUT_EXCEPTION_IDS.filter(id => raw.includes(id));
}

export const DEFAULT_KEYBOARD_SETTINGS: KeyboardSettings = {
    terminalFocusPolicy: DEFAULT_TERMINAL_FOCUS_SHORTCUT_POLICY,
    terminalShortcutExceptions: [...RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS],
    secondaryShortcutsVersion: SECONDARY_SHORTCUTS_VERSION,
};

export function normalizeKeyboardSettings(raw: unknown): KeyboardSettings {
    const source = raw && typeof raw === 'object' ? (raw as Partial<KeyboardSettings>) : {};
    const adopted = typeof source.secondaryShortcutsVersion === 'number' && Number.isInteger(source.secondaryShortcutsVersion)
        && source.secondaryShortcutsVersion >= SECONDARY_SHORTCUTS_VERSION;
    const version = adopted ? source.secondaryShortcutsVersion : SECONDARY_SHORTCUTS_VERSION;
    const exceptions = normalizeTerminalShortcutExceptions(source.terminalShortcutExceptions);
    return {
        terminalFocusPolicy: normalizeTerminalFocusPolicy(source.terminalFocusPolicy),
        // Migration changes ownership only. It never changes/removes a user's keys.
        // Return the marker with the list so every preference save persists both;
        // repeated normalization and reloads cannot undo a later explicit opt-out.
        terminalShortcutExceptions: adopted ? exceptions
            : normalizeTerminalShortcutExceptions([...exceptions, ...SECONDARY_SHORTCUT_IDS]),
        secondaryShortcutsVersion: version,
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
            if (focus === 'xterm' && (policy === 'app' || terminalException)) return true;
            return false;
        case 'field':
            return false;
        case 'files':
            return false;
        default:
            return false;
    }
}
