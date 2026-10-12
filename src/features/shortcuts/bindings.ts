import { formatShortcutLabel, normalizeShortcutKey } from '../../lib/shortcuts';
import type { ShortcutCommand } from './types';

export type ShortcutOverrides = Readonly<Record<string, string | undefined>>;

/** Missing overrides inherit defaults; an explicit empty string disables all chords. */
export function shortcutBindings(command: ShortcutCommand, overrides: ShortcutOverrides): readonly string[] {
    const primary = command.settingsKey ? overrides[command.settingsKey] ?? command.defaultKeys : command.defaultKeys;
    return primary ? [primary, ...(command.extraKeys ?? [])] : [];
}

/** Configured chords stay visible in the editor even when a default is inactive. */
export function shortcutBindingLabel(command: ShortcutCommand, overrides: ShortcutOverrides): string {
    return shortcutBindings(command, overrides).map(chord => formatShortcutLabel(chord)).join(' / ') || 'Not set';
}

/** Canonical event-equivalent modifiers for conflict checks, not terminal-program guessing. */
export function canonicalShortcut(chord: string, isMac: boolean): string {
    const parts = chord.toLowerCase().split('+').map(part => part.trim());
    let key = normalizeShortcutKey(parts.pop() ?? '');
    const modifiers = new Set(parts.map(part => {
        if (part === 'mod') return isMac ? 'meta' : 'ctrl';
        if (['cmd', 'command', 'super', 'win'].includes(part)) return 'meta';
        return part === 'control' ? 'ctrl' : part;
    }));
    if (modifiers.has('shift') && /^[0-9]$/.test(key)) key = ')!@#$%^&*('[Number(key)];
    return [...modifiers].sort().concat(key).join('|');
}

/** Potential overlap across supported policies. Separate file/terminal surfaces do not collide. */
function scopesOverlap(a: ShortcutCommand, b: ShortcutCommand): boolean {
    if (a.when === 'field' || b.when === 'field') return false;
    if (a.when === 'files' || b.when === 'files') {
        return a.when !== 'xterm' && b.when !== 'xterm';
    }
    return true;
}

export interface ShortcutBindingResolution {
    active: readonly string[];
    /** Defaults remain configured; no migration or settings write disables them. */
    inactive: readonly { chord: string; overriddenBy: readonly ShortcutCommand[] }[];
}

function hasCustomPrimary(command: ShortcutCommand, overrides: ShortcutOverrides, isMac: boolean): boolean {
    const value = command.settingsKey ? overrides[command.settingsKey] : undefined;
    // Loaded settings include materialized defaults, so property presence alone
    // cannot distinguish a user remap from an inherited binding.
    return Boolean(value && value !== command.defaultKeys
        && canonicalShortcut(value, isMac) !== canonicalShortcut(command.defaultKeys, isMac));
}

/**
 * Resolve inherited chords against user remaps before focus/terminal ownership.
 * A custom app key still protects its terminal pass-through when unreserved;
 * a newly reserved default must not steal it. Fixed aliases remain defaults.
 * Removing/resetting the custom binding automatically revives displaced defaults.
 */
export function resolveShortcutBindings(
    command: ShortcutCommand,
    overrides: ShortcutOverrides,
    catalog: readonly ShortcutCommand[],
    isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform),
): ShortcutBindingResolution {
    const configured = shortcutBindings(command, overrides);
    const customPrimary = hasCustomPrimary(command, overrides, isMac);
    if (!configured.length || (configured.length === 1 && customPrimary)) return { active: configured, inactive: [] };
    const customPeers = catalog.filter(other => other.id !== command.id && scopesOverlap(command, other)
        && hasCustomPrimary(other, overrides, isMac));
    const active: string[] = [];
    const inactive: { chord: string; overriddenBy: readonly ShortcutCommand[] }[] = [];
    configured.forEach((chord, index) => {
        const overriddenBy = index === 0 && customPrimary ? [] : customPeers.filter(other =>
            canonicalShortcut(shortcutBindings(other, overrides)[0], isMac) === canonicalShortcut(chord, isMac));
        if (overriddenBy.length) inactive.push({ chord, overriddenBy });
        else active.push(chord);
    });
    return { active, inactive };
}

/** Describe effective terminal bindings without advertising displaced defaults. */
export function activeShortcutBindingLabel(command: ShortcutCommand, overrides: ShortcutOverrides,
    catalog: readonly ShortcutCommand[], isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)): string {
    const resolved = resolveShortcutBindings(command, overrides, catalog, isMac);
    return resolved.active.map(chord => formatShortcutLabel(chord, isMac)).join(' / ')
        || (resolved.inactive.length ? 'Inactive (custom shortcut conflict)' : 'Not set');
}

/** Editor warnings explain precedence while preserving the configured binding. */
export function shortcutBindingWarning(command: ShortcutCommand, overrides: ShortcutOverrides,
    catalog: readonly ShortcutCommand[], isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)): string | undefined {
    const resolved = resolveShortcutBindings(command, overrides, catalog, isMac);
    if (resolved.inactive.length) {
        const blockers = [...new Set(resolved.inactive.flatMap(binding => binding.overriddenBy.map(other => other.label)))];
        return `Inactive: ${resolved.inactive.map(binding => formatShortcutLabel(binding.chord, isMac)).join(', ')}. Custom shortcuts for ${blockers.join(', ')} take priority. Remap this binding, or reset/remove the conflicting custom shortcut.`;
    }
    const conflicts = shortcutConflicts(command, overrides, catalog, isMac);
    if (!conflicts.length) return undefined;
    const activeKeys = new Set(resolved.active.map(chord => canonicalShortcut(chord, isMac)));
    const activeConflicts = conflicts.filter(other => resolveShortcutBindings(other, overrides, catalog, isMac).active
        .some(chord => activeKeys.has(canonicalShortcut(chord, isMac))));
    if (activeConflicts.length) {
        return `Overlapping binding: ${activeConflicts.map(other => other.label).join(', ')}. Remap one of these shortcuts to remove the conflict.`;
    }
    return hasCustomPrimary(command, overrides, isMac)
        ? `Your custom shortcut takes priority over conflicting defaults for ${conflicts.map(other => other.label).join(', ')}.`
        : undefined;
}

/** Include fixed aliases and hidden commands; duplicate keys are only conflicts in overlapping scopes. */
export function shortcutConflicts(
    command: ShortcutCommand,
    overrides: ShortcutOverrides,
    catalog: readonly ShortcutCommand[],
    isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform),
): readonly ShortcutCommand[] {
    const keys = new Set(shortcutBindings(command, overrides).map(chord => canonicalShortcut(chord, isMac)));
    return catalog.filter(other => other.id !== command.id && scopesOverlap(command, other)
        && shortcutBindings(other, overrides).some(chord => keys.has(canonicalShortcut(chord, isMac))));
}

/** Validate edits before saving; existing user bindings remain untouched and visible. */
export function shortcutBindingIssue(command: ShortcutCommand, value: string, overrides: ShortcutOverrides,
    catalog: readonly ShortcutCommand[], isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform)): string | undefined {
    if (!value) return undefined;
    const parts = value.split('+');
    if (command.keyConstraint === 'arrow' && !/^(arrow)?(left|right|up|down)$/i.test(parts[parts.length - 1] ?? '')) {
        return 'Use an arrow key for directional pane focus; its modifiers can be changed.';
    }
    if (command.when !== 'files' && !/(^|\+)(mod|ctrl|control|alt|meta|cmd|command|super)\+/i.test(value)
        && !/^F\d{1,2}$/i.test(value)) {
        return 'Use Ctrl, Command or Alt, or a function key, so ordinary typing stays available.';
    }
    // Reset may restore an inactive default, but never replaces another command's
    // custom choice. Re-recording an existing remap also keeps upgrade conflicts
    // visible without rejecting the user's settled configuration.
    const current = shortcutBindings(command, overrides)[0];
    if (canonicalShortcut(value, isMac) === canonicalShortcut(command.defaultKeys, isMac)
        || (current && canonicalShortcut(value, isMac) === canonicalShortcut(current, isMac))) return undefined;
    const next = command.settingsKey ? { ...overrides, [command.settingsKey]: value } : overrides;
    const conflicts = shortcutConflicts(command, next, catalog, isMac);
    return conflicts.length ? `Already used by ${conflicts.map(row => row.label).join(', ')} in an overlapping context. Remove or change that binding first.` : undefined;
}

/** Recorder never turns composition/AltGraph text into a global shortcut. */
export function recordedShortcut(event: KeyboardEvent, isMac: boolean): string | undefined {
    if (event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')
        || ['Dead', 'Process', 'Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return undefined;
    const parts: string[] = [];
    if ((isMac && event.metaKey) || (!isMac && event.ctrlKey)) parts.push('Mod');
    if (isMac && event.ctrlKey) parts.push('Ctrl');
    if (!isMac && event.metaKey) parts.push('Meta');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');
    const key = event.key === ' ' ? 'Space' : event.key === '+' ? 'Plus'
        : event.key.length === 1 ? event.key.toUpperCase() : event.key;
    return [...parts, key].join('+');
}
