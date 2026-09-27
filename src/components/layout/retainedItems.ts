/** Closed items leave immediately; unvisited items never mount. */
export function retainLiveItems(
    available: readonly string[],
    visited: ReadonlySet<string>,
    active: string | null,
): ReadonlySet<string> {
    return new Set(available.filter(id => visited.has(id) || id === active));
}
