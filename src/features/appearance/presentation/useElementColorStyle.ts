import { useLayoutEffect, useRef } from 'react';
import { createElementColorStyle } from './elementColorStyle';

/** Attach to the host once; update colors without changing content keys, parents or mounts. */
export function useElementColorStyle(value: unknown, refreshTerminals: () => void): void {
    const controller = useRef<ReturnType<typeof createElementColorStyle> | null>(null);
    useLayoutEffect(() => {
        const owner = createElementColorStyle(document, refreshTerminals);
        controller.current = owner;
        return () => { owner.dispose(); controller.current = null; };
    }, [refreshTerminals]);
    useLayoutEffect(() => { controller.current?.update(value); }, [value, refreshTerminals]);
}
