import { suppressDropClick } from './suppressDropClick';
import type { DragPoint, TabDragSession, TabDragStart } from './types';

export const TAB_DRAG_THRESHOLD = 8;
const owners = new WeakMap<Window, symbol>();

/** One controller for tab/pane gestures. Only chrome is touched by its adapters. */
export function beginTabDrag(event: TabDragStart, session: TabDragSession, completed: () => void): () => void {
    const target = event.currentTarget;
    const view = target.ownerDocument?.defaultView ?? window;
    const owner = Symbol('tab drag');
    const origin = { x: event.clientX, y: event.clientY };
    let point: DragPoint = origin;
    let started = false;
    let finished = false;
    let frame: number | null = null;
    const capture = target as HTMLElement;

    const cleanup = () => {
        finished = true;
        if (frame !== null) view.cancelAnimationFrame(frame);
        frame = null;
        view.removeEventListener('pointermove', move);
        view.removeEventListener('pointerup', release);
        view.removeEventListener('pointercancel', release);
        view.removeEventListener('keydown', key);
        view.removeEventListener('blur', cancel);
        view.removeEventListener('contextmenu', cancel);
        target.ownerDocument?.removeEventListener('visibilitychange', visibility);
        target.removeEventListener('lostpointercapture', lostCapture);
        if (owners.get(view) === owner) owners.delete(view);
        try {
            if (capture.hasPointerCapture?.(event.pointerId)) capture.releasePointerCapture(event.pointerId);
        } catch { /* A disposed WebView handle may already have released capture. */ }
        session.dispose();
    };
    const cancel = () => {
        if (finished) return;
        try { cleanup(); } finally { if (started) session.cancel(); }
    };
    const valid = () => !finished && session.isValid() && (!started || owners.get(view) === owner);
    const paint = () => {
        frame = null;
        if (!valid()) { cancel(); return; }
        try {
            if (session.move(point) && !finished && frame === null) frame = view.requestAnimationFrame(paint);
        } catch (error) { cancel(); throw error; }
    };
    const move = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        if (!valid()) { cancel(); return; }
        if (!started) {
            if (owners.has(view)) { cancel(); return; }
            if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < TAB_DRAG_THRESHOLD) return;
            owners.set(view, owner);
            started = true;
            try {
                // In-progress starts need cancellation on errors/reentrant unmount;
                // an explicit refusal, however, never started an adapter gesture.
                if (session.start(origin) === false) { started = false; cancel(); return; }
                if (!valid()) { cancel(); return; }
                target.addEventListener('lostpointercapture', lostCapture);
                try { capture.setPointerCapture?.(event.pointerId); } catch { /* Capture is best-effort. */ }
            } catch (error) { cancel(); throw error; }
        }
        if (next.cancelable) next.preventDefault();
        point = { x: next.clientX, y: next.clientY };
        if (frame === null) frame = view.requestAnimationFrame(paint);
    };
    const release = (end: PointerEvent) => {
        if (end.pointerId !== event.pointerId || finished) return;
        if (end.type === 'pointercancel' || !valid() || !started) { cancel(); return; }
        let action: (() => boolean) | null;
        try { action = session.resolveDrop({ x: end.clientX, y: end.clientY }); }
        catch (error) { cancel(); throw error; }
        cleanup();
        // A completed gesture consumes the release click even if the store refuses it.
        completed();
        suppressDropClick(view);
        try { if (!action || !action()) session.cancel(); }
        catch (error) { session.cancel(); throw error; }
    };
    const key = (next: KeyboardEvent) => { if (next.key === 'Escape') { next.preventDefault(); cancel(); } };
    const visibility = () => { if (target.ownerDocument.hidden) cancel(); };
    const lostCapture = (next: Event) => { if ((next as PointerEvent).pointerId === event.pointerId) cancel(); };

    view.addEventListener('pointermove', move, { passive: false });
    view.addEventListener('pointerup', release);
    view.addEventListener('pointercancel', release);
    view.addEventListener('keydown', key);
    view.addEventListener('blur', cancel);
    view.addEventListener('contextmenu', cancel);
    target.ownerDocument?.addEventListener('visibilitychange', visibility);
    return cancel;
}
