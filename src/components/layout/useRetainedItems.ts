import { useEffect, useState } from 'react';
import { retainLiveItems } from './retainedItems';

/** Retain visited items only while they remain in the live inventory. */
export function useRetainedItems(available: readonly string[], active: string | null): ReadonlySet<string> {
    const [visited, setVisited] = useState<ReadonlySet<string>>(new Set());
    const retained = retainLiveItems(available, visited, active);

    useEffect(() => {
        setVisited(previous => {
            const next = retainLiveItems(available, previous, active);
            return next.size === previous.size && [...next].every(id => previous.has(id))
                ? previous
                : next;
        });
    }, [available, active]);

    return retained;
}
