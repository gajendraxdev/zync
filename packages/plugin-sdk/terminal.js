const overlayElements = new Set();
const overlayListeners = new Set();
const notifyOverlays = () => { for (const listener of overlayListeners) listener(); };

/**
 * Register a plugin popup while open. Geometry only: never grants terminal I/O.
 * Call dispose on close/unmount. Updates are event-driven and frame-coalesced
 * by each surface. The host protects trusted chrome and bounds all rectangles.
 */
export function registerTerminalOverlay(element) {
    if (!(element instanceof HTMLElement)) throw new TypeError('An overlay element is required');
    if (overlayElements.has(element)) throw new Error('Overlay already registered');
    if (overlayElements.size >= 8) throw new Error('Too many terminal overlays');
    overlayElements.add(element);
    const resize = new ResizeObserver(notifyOverlays);
    const mutation = new MutationObserver(notifyOverlays);
    for (let node = element; node; node = node.parentElement) {
        resize.observe(node);
        mutation.observe(node, { attributes: true, childList: true, attributeFilter: ['class', 'style', 'hidden'] });
    }
    notifyOverlays();
    let disposed = false;
    return Object.freeze({ refresh: notifyOverlays, dispose() {
        if (disposed) return;
        disposed = true;
        resize.disconnect(); mutation.disconnect();
        overlayElements.delete(element); notifyOverlays();
    } });
}

/** Visible popup geometry; hidden ancestors and removed elements cannot mask a surface. */
function overlayRects() {
    const result = [];
    for (const element of overlayElements) {
        if (!element.isConnected) continue;
        let visible = true;
        for (let node = element; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden') { visible = false; break; }
        }
        if (!visible) continue;
        const { x, y, width, height } = element.getBoundingClientRect();
        if (width > 0 && height > 0) result.push({ x, y, width, height });
    }
    return result;
}

/** Optional host terminal slot. No PTY input, output or approval access. */
export function mountTerminalSurface(element, offerId, options = {}) {
    if (!(element instanceof HTMLElement) || typeof offerId !== 'string' || !offerId || offerId.length > 128)
        throw new TypeError('A slot and offer ID are required');
    let nonce = null, revision = 0, disposed = false, frame = 0, settle, supportsOverlays = false;
    const ready = new Promise(resolve => { settle = resolve; });
    const timeout = setTimeout(() => { settle(false); dispose(); }, Math.min(10000, Math.max(100, options.timeoutMs ?? 3000)));
    const post = (rect, closing = false) => {
        if (nonce) {
            const overlays = closing ? [] : overlayRects();
            // Older parsers reject unknown fields. Safely hide, never dispose,
            // while a popup is open on a host without overlay capability.
            window.parent.postMessage({ type: 'zync:terminal:surface', nonce, offerId, revision: ++revision,
                rect: !supportsOverlays && overlays.length ? null : rect, dispose: closing,
                ...(supportsOverlays ? { overlays } : {}) }, '*');
        }
    };
    const measure = () => {
        if (disposed)
            return;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            if (disposed || !nonce)
                return;
            if (!element.isConnected) {
                dispose();
                return;
            }
            for (let node = element; node; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (style.transform !== 'none' || style.visibility === 'hidden' || style.display === 'none') {
                    post(null);
                    return;
                }
            }
            const rect = element.getBoundingClientRect();
            post(rect.width > 0 && rect.height > 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null);
        });
    };
    const listener = event => {
        if (event.source !== window.parent || disposed)
            return;
        const data = event.data;
        if (data?.type !== 'zync:terminal:host' || data.version !== 1 || typeof data.nonce !== 'string' || data.nonce.length > 128)
            return;
        if (nonce && nonce !== data.nonce) {
            dispose();
            return;
        }
        nonce = data.nonce;
        supportsOverlays = data.overlays === true;
        clearTimeout(timeout);
        settle(true);
        measure();
    };
    const observer = new ResizeObserver(measure);
    overlayListeners.add(measure);
    for (let node = element; node; node = node.parentElement)
        observer.observe(node);
    window.addEventListener('message', listener);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const visibility = window.zync?.pane?.onVisibilityChange?.(measure);
    const mutation = new MutationObserver(measure);
    // Observe ancestor styles only; never poll or observe all plugin DOM mutations.
    for (let node = element; node; node = node.parentElement)
        mutation.observe(node, { attributes: true, childList: true, attributeFilter: ['class', 'style', 'hidden'] });
    function dispose() {
        if (disposed)
            return;
        disposed = true;
        post(null, true);
        settle(false);
        clearTimeout(timeout);
        cancelAnimationFrame(frame);
        observer.disconnect();
        overlayListeners.delete(measure);
        mutation.disconnect();
        visibility?.();
        window.removeEventListener('message', listener);
        window.removeEventListener('resize', measure);
        window.removeEventListener('scroll', measure, true);
    }
    window.parent.postMessage({ type: 'zync:terminal:hello' }, '*');
    return Object.freeze({ ready, refresh: measure, dispose });
}
