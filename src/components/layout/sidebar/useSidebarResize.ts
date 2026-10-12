import { useCallback, useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';

export interface SidebarWidthLimits { minWidth: number; maxWidth: number; defaultWidth: number }
export const DEFAULT_SIDEBAR_WIDTH_LIMITS: SidebarWidthLimits = { minWidth: 200, maxWidth: 600, defaultWidth: 288 };

// Persistence uses whole pixels, but live pointer painting preserves fractional geometry.
export function clampSidebarWidth(width: number, limits = DEFAULT_SIDEBAR_WIDTH_LIMITS) {
    return Math.max(limits.minWidth, Math.min(Number.isFinite(width) ? Math.round(width) : limits.defaultWidth, limits.maxWidth));
}

export function useSidebarResize(savedWidth: number, onCommit: (width: number) => void, side: 'left' | 'right' = 'left',
    limits = DEFAULT_SIDEBAR_WIDTH_LIMITS, enabled = true) {
    const { minWidth, maxWidth, defaultWidth } = limits;
    const clampWidth = useCallback((value: number) => clampSidebarWidth(value, { minWidth, maxWidth, defaultWidth }), [minWidth, maxWidth, defaultWidth]);
    const [width, setWidth] = useState(clampWidth(savedWidth));
    const [isResizing, setIsResizing] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const widthRef = useRef(width);
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const commitRef = useRef(onCommit);
    commitRef.current = onCommit;
    const drag = useRef<{ node: HTMLDivElement; pointerId: number; startX: number; startWidth: number; side: 'left' | 'right'; cursor: string } | null>(null);
    const frame = useRef(0);
    const releaseFrame = useRef(0);
    const paintWidth = useCallback((value: number, node: HTMLDivElement) => {
        const sidebar = sidebarRef.current;
        if (!sidebar) return;
        sidebar.style.width = `${enabledRef.current ? value : 0}px`;
        // Keep sizing local: an inherited live CSS variable invalidates styles
        // across the entire host/AI subtree on every pointer frame.
        if (contentRef.current) {
            contentRef.current.style.width = `${value}px`;
            contentRef.current.style.minWidth = `${value}px`;
        }
        node.setAttribute('aria-valuenow', String(Math.round(value)));
    }, []);
    const finish = useCallback((commit: boolean) => {
        const current = drag.current;
        if (!current) return;
        drag.current = null;
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        if (current.node.hasPointerCapture(current.pointerId)) current.node.releasePointerCapture(current.pointerId);
        document.body.style.cursor = current.cursor;
        widthRef.current = clampWidth(widthRef.current);
        paintWidth(widthRef.current, current.node);
        setWidth(widthRef.current);
        // Paint the final width without a transition before restoring collapse animations.
        cancelAnimationFrame(releaseFrame.current);
        releaseFrame.current = 0;
        if (commit) releaseFrame.current = requestAnimationFrame(() => { releaseFrame.current = 0; setIsResizing(false); });
        else setIsResizing(false);
        window.dispatchEvent(new CustomEvent('zync:layout-transition-end'));
        // A caller's persistence failure must not interrupt interaction cleanup.
        if (commit) commitRef.current(widthRef.current);
    }, [clampWidth, paintWidth]);
    useEffect(() => {
        if (drag.current) return;
        widthRef.current = clampWidth(savedWidth);
        setWidth(widthRef.current);
    }, [savedWidth, clampWidth]);
    useEffect(() => { finish(false); }, [side, minWidth, maxWidth, finish]);
    useEffect(() => { if (!enabled) finish(true); }, [enabled, finish]);
    useEffect(() => {
        const onBlur = () => finish(true);
        window.addEventListener('blur', onBlur);
        return () => { window.removeEventListener('blur', onBlur); finish(false); cancelAnimationFrame(releaseFrame.current); };
    }, [finish]);
    const handlers = {
        onPointerDown(event: PointerEvent<HTMLDivElement>) {
            if (!enabled || drag.current || event.button !== 0 || !event.isPrimary) return;
            event.preventDefault();
            const node = event.currentTarget;
            node.setPointerCapture(event.pointerId);
            const bounds = node.parentElement?.getBoundingClientRect();
            widthRef.current = Math.max(minWidth, Math.min(bounds?.width ?? widthRef.current, maxWidth));
            drag.current = { node, pointerId: event.pointerId, startX: event.clientX, startWidth: widthRef.current,
                side, cursor: document.body.style.cursor };
            cancelAnimationFrame(releaseFrame.current);
            document.body.style.cursor = 'col-resize';
            setIsResizing(true);
            window.dispatchEvent(new CustomEvent('zync:layout-transition-start'));
        },
        onPointerMove(event: PointerEvent<HTMLDivElement>) {
            if (!drag.current || drag.current.pointerId !== event.pointerId) return;
            const delta = (event.clientX - drag.current.startX) * (drag.current.side === 'right' ? -1 : 1);
            widthRef.current = Math.max(minWidth, Math.min(drag.current.startWidth + delta, maxWidth));
            if (!frame.current) frame.current = requestAnimationFrame(() => {
                frame.current = 0;
                if (drag.current) paintWidth(widthRef.current, drag.current.node);
            });
        },
        onPointerUp(event: PointerEvent<HTMLDivElement>) { if (drag.current?.pointerId === event.pointerId) finish(true); },
        onPointerCancel(event: PointerEvent<HTMLDivElement>) { if (drag.current?.pointerId === event.pointerId) finish(true); },
        onLostPointerCapture(event: PointerEvent<HTMLDivElement>) { if (drag.current?.pointerId === event.pointerId) finish(true); },
        onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
            const direction = side === 'right' ? -1 : 1;
            if (!enabled || drag.current) return;
            const next = event.key === 'ArrowLeft' ? widthRef.current - 16 * direction : event.key === 'ArrowRight' ? widthRef.current + 16 * direction : event.key === 'Home' ? minWidth : event.key === 'End' ? maxWidth : null;
            if (next === null) return;
            event.preventDefault();
            widthRef.current = clampWidth(next);
            setWidth(widthRef.current);
            commitRef.current(widthRef.current);
        },
    };
    return { width, isResizing, sidebarRef, contentRef, handlers };
}
