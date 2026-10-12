/** Maximum Unicode code points in a user-facing display alias. */
export const MAX_DISPLAY_ALIAS_LENGTH = 80;

/** Canonical text cleanup shared by interactive validation and bounded persistence. */
function normalizeDisplayAliasText(value: string): string {
    return value.normalize('NFC')
        .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export type DisplayAliasDraftResult =
    | { ok: true; alias: string | undefined }
    | { ok: false; reason: 'too-long' };

/** Validate a user's normalized draft without truncation; empty text resets the alias. */
export function parseDisplayAliasDraft(value: string): DisplayAliasDraftResult {
    const text = normalizeDisplayAliasText(value);
    return Array.from(text).length > MAX_DISPLAY_ALIAS_LENGTH
        ? { ok: false, reason: 'too-long' }
        : { ok: true, alias: text || undefined };
}

/**
 * Normalize presentation-only text at persistence boundaries. Aliases are never
 * identifiers, paths or commands. Bound stored input after removing control and
 * direction marks; interactive editing uses parseDisplayAliasDraft to reject long text.
 */
export function normalizeDisplayAlias(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = normalizeDisplayAliasText(value);
    return Array.from(text).slice(0, MAX_DISPLAY_ALIAS_LENGTH).join('').trim() || undefined;
}

/** An explicit alias wins without modifying the live, feature-owned title. */
export function resolveDisplayTitle(defaultTitle: string, displayAlias?: string): string {
    return normalizeDisplayAlias(displayAlias) ?? defaultTitle;
}

/**
 * Move by stable IDs, using the same insertion semantics as tab drag-and-drop.
 * Invalid, stale or ambiguous inventories are no-ops, preserving object identity.
 */
export function reorderItemsById<T extends { id: string }>(items: T[], sourceId: string, targetId: string): T[] {
    if (sourceId === targetId || new Set(items.map(item => item.id)).size !== items.length) return items;
    const from = items.findIndex(item => item.id === sourceId);
    const to = items.findIndex(item => item.id === targetId);
    if (from < 0 || to < 0) return items;
    const result = [...items];
    const [moved] = result.splice(from, 1);
    result.splice(to, 0, moved);
    return result;
}
