const REPLY_INTERVAL_MS = 100;

/**
 * Rate-limit handshake replies without dropping the final request in a burst.
 * One pending timer serves all waiting mounts; disposal prevents stale-document
 * replies. The initial announcement uses the same rate limit as later requests.
 */
export function createTerminalHandshakeReply(reply: () => void) {
    let lastReply = -Infinity;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const request = () => {
        if (disposed || timer !== undefined) return;
        const remaining = REPLY_INTERVAL_MS - (performance.now() - lastReply);
        if (remaining > 0) {
            timer = setTimeout(() => {
                timer = undefined;
                request();
            }, remaining);
            return;
        }
        lastReply = performance.now();
        reply();
    };

    return {
        request,
        dispose() {
            disposed = true;
            if (timer !== undefined) clearTimeout(timer);
            timer = undefined;
        },
    };
}
