import { matchShortcut } from '../../lib/shortcuts.js';
import { allowsWhen, DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS, type TerminalFocusShortcutPolicy } from './policy.js';
import { resolveShortcutBindings, shortcutBindings } from './bindings.js';
import type { KeyboardFocus, ShortcutCommand } from './types.js';

/** Composition and AltGraph input belong to the text/terminal input engine. */
export function isShortcutInput(event: KeyboardEvent): boolean {
    return event.type === 'keydown' && !event.defaultPrevented && !event.isComposing
        && event.keyCode !== 229 && event.key !== 'Dead' && event.key !== 'Process'
        && !event.getModifierState?.('AltGraph');
}

/** Pure routing boundary: one owner, one action, no store/DOM/PTY side effects. */
export function routeShortcut(
    event: KeyboardEvent,
    focus: KeyboardFocus,
    policy: TerminalFocusShortcutPolicy,
    catalog: readonly ShortcutCommand[],
    overrides: Partial<Record<string, string>>,
    run: (id: string, event: KeyboardEvent) => boolean,
    terminalExceptions: readonly string[] = DEFAULT_TERMINAL_SHORTCUT_EXCEPTIONS,
): boolean {
    if (!isShortcutInput(event)) return false;
    for (const command of catalog) {
        const reserved = Boolean(command.terminalReservation) && terminalExceptions.includes(command.id);
        if (!allowsWhen(command.when, focus, policy, command.terminalUtility || reserved)) continue;
        // Ordinary typing pays no conflict-resolution cost. Resolve only a
        // matching chord, before an inherited default can claim the event.
        const matching = shortcutBindings(command, overrides).filter(chord => matchShortcut(event, chord));
        if (!matching.length || !resolveShortcutBindings(command, overrides, catalog).active.some(chord => matching.includes(chord))) continue;
        // Consume repeats of an owned app chord without sending them to the PTY.
        if (event.repeat && !command.repeatable) return true;
        return run(command.id, event);
    }
    return false;
}
