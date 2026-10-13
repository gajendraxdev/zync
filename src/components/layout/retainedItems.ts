/** Surviving hosts keep mount order; closed items leave and unvisited items stay lazy. */
export function retainLiveItems(
    available: readonly string[],
    visited: ReadonlySet<string>,
    active: string | null,
): ReadonlySet<string> {
    const live = new Set(available);
    const retained = new Set([...visited].filter(id => live.has(id)));
    if (active !== null && live.has(active)) retained.add(active);
    return retained;
}

/** Resolve current metadata without moving retained hosts when presentation order changes. */
export function retainedItemsInMountOrder<T extends { id: string }>(
    available: readonly T[],
    retained: ReadonlySet<string>,
): T[] {
    const byId = new Map(available.map(item => [item.id, item]));
    return [...retained].flatMap(id => {
        const item = byId.get(id);
        return item ? [item] : [];
    });
}
