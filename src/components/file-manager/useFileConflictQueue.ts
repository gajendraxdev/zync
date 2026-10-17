import { useCallback, useRef, useState } from 'react';

/** Own unresolved decisions separately from the file operations they authorize. */
export function useFileConflictQueue<T>() {
    const [conflicts, setConflicts] = useState<T[]>([]);
    const pending = useRef<T[]>([]);

    const replace = useCallback((next: T[]) => {
        pending.current = next;
        setConflicts(next);
    }, []);

    const clear = useCallback(() => replace([]), [replace]);

    // Consume synchronously before awaiting I/O, so a repeated event cannot submit twice.
    const take = useCallback((expected: T, all: boolean): T[] => {
        if (pending.current[0] !== expected) return [];
        const accepted = all ? pending.current : pending.current.slice(0, 1);
        replace(all ? [] : pending.current.slice(1));
        return accepted;
    }, [replace]);

    return { conflicts, current: conflicts[0] ?? null, replace, clear, take };
}
