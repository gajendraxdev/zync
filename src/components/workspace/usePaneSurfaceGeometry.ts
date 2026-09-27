import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react';

/** Slots may be recreated; content elements never change DOM parents. */
export function usePaneSurfaceGeometry(container: RefObject<HTMLDivElement | null>) {
    const slots = useRef(new Map<string, HTMLDivElement>());
    const hosts = useRef(new Map<string, HTMLDivElement>());
    const observer = useRef<ResizeObserver | null>(null);
    const frame = useRef(0);

    const measure = useCallback(() => {
        const root = container.current;
        if (!root) return;
        const origin = root.getBoundingClientRect();
        // Read every rectangle before writing styles, avoiding layout thrashing.
        const rectangles = [...hosts.current].map(([key, host]) => {
            const slot = slots.current.get(key);
            const rect = slot?.getClientRects().length ? slot.getBoundingClientRect() : null;
            return { host, rect };
        });
        for (const { host, rect } of rectangles) {
            if (!rect || rect.width <= 0 || rect.height <= 0) {
                host.style.visibility = 'hidden';
                continue;
            }
            host.style.left = `${rect.left - origin.left}px`;
            host.style.top = `${rect.top - origin.top}px`;
            host.style.width = `${rect.width}px`;
            host.style.height = `${rect.height}px`;
            host.style.visibility = 'visible';
        }
    }, [container]);

    const schedule = useCallback(() => {
        if (!frame.current) frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            measure();
        });
    }, [measure]);

    const registerSlot = useCallback((key: string, node: HTMLDivElement | null) => {
        const previous = slots.current.get(key);
        if (previous) observer.current?.unobserve(previous);
        if (node) {
            slots.current.set(key, node);
            observer.current?.observe(node);
        } else slots.current.delete(key);
        schedule();
    }, [schedule]);

    const registerHost = useCallback((key: string, node: HTMLDivElement | null) => {
        if (node) hosts.current.set(key, node);
        else hosts.current.delete(key);
        schedule();
    }, [schedule]);

    useLayoutEffect(() => {
        const resizeObserver = new ResizeObserver(schedule);
        observer.current = resizeObserver;
        if (container.current) resizeObserver.observe(container.current);
        for (const node of slots.current.values()) resizeObserver.observe(node);
        window.addEventListener('resize', schedule);
        return () => {
            resizeObserver.disconnect();
            observer.current = null;
            window.removeEventListener('resize', schedule);
            if (frame.current) cancelAnimationFrame(frame.current);
            frame.current = 0;
        };
    }, [container, schedule]);

    // A committed owner change can move a slot without resizing it.
    useLayoutEffect(measure);

    return { registerSlot, registerHost };
}
