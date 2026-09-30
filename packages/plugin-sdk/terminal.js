/** Optional host terminal slot. No PTY input, output or approval access. */
export function mountTerminalSurface(element, offerId, options = {}) {
    if (!(element instanceof HTMLElement) || typeof offerId !== 'string' || !offerId || offerId.length > 128)
        throw new TypeError('A slot and offer ID are required');
    let nonce = null, revision = 0, disposed = false, frame = 0, settle;
    const ready = new Promise(resolve => { settle = resolve; });
    const timeout = setTimeout(() => { settle(false); dispose(); }, Math.min(10000, Math.max(100, options.timeoutMs ?? 3000)));
    const post = (rect, closing = false) => {
        if (nonce)
            window.parent.postMessage({ type: 'zync:terminal:surface', nonce, offerId, revision: ++revision, rect, dispose: closing }, '*');
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
        clearTimeout(timeout);
        settle(true);
        measure();
    };
    const observer = new ResizeObserver(measure);
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
        mutation.disconnect();
        visibility?.();
        window.removeEventListener('message', listener);
        window.removeEventListener('resize', measure);
        window.removeEventListener('scroll', measure, true);
    }
    window.parent.postMessage({ type: 'zync:terminal:hello' }, '*');
    return Object.freeze({ ready, refresh: measure, dispose });
}
