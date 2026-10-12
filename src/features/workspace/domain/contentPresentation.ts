import { normalizeDisplayAlias } from './presentation';

export const CONTENT_PRESENTATION_VERSION = 3 as const;
export const MAX_PRESENTATION_SCOPES = 256;
export const MAX_PRESENTATION_ITEMS_PER_SCOPE = 256;
export const MAX_PRESENTATION_SCOPE_LENGTH = 256;
export const MAX_PRESENTATION_KEY_LENGTH = 1024;

/** Optional decoration of an existing content instance, never a live inventory. */
export interface ContentPresentationItem {
    displayAlias?: string;
    pinned?: true;
    /** Presentation only; never removes content, changes grouping or disconnects a session. */
    hidden?: true;
}

export interface ContentPresentationScope {
    version: typeof CONTENT_PRESENTATION_VERSION;
    items: Record<string, ContentPresentationItem>;
    /** Stable content IDs only; unknown-but-valid IDs survive temporary unavailability. */
    order?: string[];
}

export type ContentPresentationMap = Record<string, ContentPresentationScope>;
export type ContentPresentationParseResult =
    | { ok: true; value: ContentPresentationMap }
    | { ok: false; reason: 'unsupported-presentation' };

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isPresentationScopeId(value: string): boolean {
    return Boolean(value.trim()) && value.length <= MAX_PRESENTATION_SCOPE_LENGTH;
}

/** Accept the canonical identity tuples shared with retained pane content hosts. */
export function isContentPresentationKey(key: string): boolean {
    if (!key || key.length > MAX_PRESENTATION_KEY_LENGTH) return false;
    try {
        const value: unknown = JSON.parse(key);
        if (!Array.isArray(value) || JSON.stringify(value) !== key) return false;
        if (value.some(part => typeof part !== 'string' || !part.trim())) return false;
        return (value[0] === 'term' && value.length === 2)
            || ((value[0] === 'feature' || value[0] === 'plugin') && value.length === 3);
    } catch {
        return false;
    }
}

/**
 * Read v1 aliases, v2 pins/order and v3 visibility without pruning absent content or rewriting unknown
 * schemas. Unknown fields/versions and oversized envelopes require a newer reader;
 * callers must preserve the file instead of replacing it with this reader's defaults.
 */
export function parseContentPresentation(raw: unknown): ContentPresentationParseResult {
    if (raw === undefined || raw === null) return { ok: true, value: {} };
    const unsupported = { ok: false, reason: 'unsupported-presentation' } as const;
    if (!isRecord(raw) || Object.keys(raw).length > MAX_PRESENTATION_SCOPES) return unsupported;
    const scopes: Array<[string, ContentPresentationScope]> = [];
    for (const [scopeId, scope] of Object.entries(raw)) {
        if (!isPresentationScopeId(scopeId) || !isRecord(scope)
            || (scope.version !== 1 && scope.version !== 2 && scope.version !== CONTENT_PRESENTATION_VERSION)
            || Object.keys(scope).some(key => key !== 'version' && key !== 'items' && !(scope.version !== 1 && key === 'order'))
            || !isRecord(scope.items)
            || Object.keys(scope.items).length > MAX_PRESENTATION_ITEMS_PER_SCOPE) return unsupported;
        const order = scope.order ?? [];
        if (!Array.isArray(order) || order.length > MAX_PRESENTATION_ITEMS_PER_SCOPE
            || Array.from(order).some(key => typeof key !== 'string' || !isContentPresentationKey(key))
            || new Set(order).size !== order.length || scope.order === null) return unsupported;
        if (new Set([...Object.keys(scope.items), ...order]).size > MAX_PRESENTATION_ITEMS_PER_SCOPE) return unsupported;
        const items: Array<[string, ContentPresentationItem]> = [];
        for (const [key, item] of Object.entries(scope.items)) {
            if (!isContentPresentationKey(key) || !isRecord(item)
                || Object.keys(item).some(field => field !== 'displayAlias'
                    && !(scope.version !== 1 && field === 'pinned')
                    && !(scope.version === 3 && field === 'hidden'))) return unsupported;
            if (item.displayAlias !== undefined && item.displayAlias !== null && typeof item.displayAlias !== 'string') return unsupported;
            if (item.pinned !== undefined && typeof item.pinned !== 'boolean') return unsupported;
            if (item.hidden !== undefined && typeof item.hidden !== 'boolean') return unsupported;
            const displayAlias = normalizeDisplayAlias(item.displayAlias);
            if (displayAlias || item.pinned || item.hidden) items.push([key, {
                ...(displayAlias && { displayAlias }),
                ...(item.pinned === true && { pinned: true as const }),
                ...(item.hidden === true && { hidden: true as const }),
            }]);
        }
        if (items.length || order.length) scopes.push([scopeId, {
            version: CONTENT_PRESENTATION_VERSION,
            items: Object.fromEntries(items),
            ...(order.length && { order: [...order] }),
        }]);
    }
    return { ok: true, value: Object.fromEntries(scopes) };
}

/** Hidden runtime identities derive from canonical live content, never dormant metadata alone. */
export function hiddenContentIds<T extends { id: string }>(
    liveItems: readonly T[],
    scope?: ContentPresentationScope,
): ReadonlySet<string> {
    return new Set(liveItems.filter(item => scope?.items[item.id]?.hidden === true).map(item => item.id));
}

/** Visual order only: pinned first, then stored ranks, with new live items appended stably. */
export function sortContentPresentation<T extends { id: string }>(
    items: readonly T[],
    scope: ContentPresentationScope | undefined,
): T[] {
    const ranks = new Map((scope?.order ?? []).map((id, index) => [id, index]));
    return items.map((item, index) => ({ item, index })).sort((a, b) => {
        const pinOrder = Number(scope?.items[b.item.id]?.pinned === true) - Number(scope?.items[a.item.id]?.pinned === true);
        if (pinOrder) return pinOrder;
        const aRank = ranks.get(a.item.id);
        const bRank = ranks.get(b.item.id);
        if (aRank !== undefined || bRank !== undefined) return (aRank ?? Infinity) - (bRank ?? Infinity);
        return a.index - b.index;
    }).map(({ item }) => item);
}
