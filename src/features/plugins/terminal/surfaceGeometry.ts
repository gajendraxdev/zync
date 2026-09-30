/** Rectangles use CSS pixels relative to the iframe's content viewport. */
export interface TerminalSurfaceRect {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface TerminalSurfaceAllocation {
    /** Full terminal size; clipping must not resize the remote PTY. */
    readonly terminal: TerminalSurfaceRect;
    /** Visible part of the slot, relative to the host's content area. */
    readonly clip: TerminalSurfaceRect;
    /** Terminal offset inside the clipped host container. */
    readonly offset: { readonly x: number; readonly y: number };
}

const MAX_COORDINATE = 16_384;

/** Parse untrusted layout data; reject non-finite, excessive and empty slots. */
export function parseTerminalSurfaceRect(value: unknown): TerminalSurfaceRect | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rect = value as Record<string, unknown>;
    if (Object.keys(rect).some(key => !['x', 'y', 'width', 'height'].includes(key))) return null;
    for (const key of ['x', 'y', 'width', 'height']) {
        if (typeof rect[key] !== 'number'
            || !Number.isFinite(rect[key])
            || Math.abs(rect[key]) > MAX_COORDINATE) return null;
    }
    if ((rect.width as number) <= 0 || (rect.height as number) <= 0) return null;
    return Object.freeze({
        x: rect.x as number,
        y: rect.y as number,
        width: rect.width as number,
        height: rect.height as number,
    });
}

/**
 * Restrict an iframe's requested slot to the trusted pane allocation. Callers
 * must also hide the surface during dialogs/docking, and when the frame is hidden.
 * No transforms or iframe-provided z-index values belong in the host surface.
 */
export function allocateTerminalSurface(
    slot: TerminalSurfaceRect,
    viewport: { readonly width: number; readonly height: number },
): TerminalSurfaceAllocation | null {
    const terminal = parseTerminalSurfaceRect(slot);
    if (!terminal || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height)
        || viewport.width <= 0 || viewport.height <= 0) return null;
    const x = Math.max(0, terminal.x);
    const y = Math.max(0, terminal.y);
    const right = Math.min(viewport.width, terminal.x + terminal.width);
    const bottom = Math.min(viewport.height, terminal.y + terminal.height);
    if (right <= x || bottom <= y) return null;
    return {
        terminal,
        clip: { x, y, width: right - x, height: bottom - y },
        offset: { x: terminal.x - x, y: terminal.y - y },
    };
}
