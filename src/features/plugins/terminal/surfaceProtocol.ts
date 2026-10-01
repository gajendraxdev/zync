import { parseTerminalSurfaceRect, type TerminalSurfaceRect } from './surfaceGeometry.js';
import { MAX_TERMINAL_OVERLAYS } from './surfaceOcclusion.js';
export interface TerminalSurfaceMessage {
    type: 'zync:terminal:surface';
    nonce: string;
    offerId: string;
    revision: number;
    rect: TerminalSurfaceRect | null;
    dispose: boolean;
    overlays: TerminalSurfaceRect[];
}
/** Geometry is the only iframe influence; no styles, commands or native IDs. */
export function parseTerminalSurfaceMessage(data: unknown, nonce: string, offer: string, previous: number): TerminalSurfaceMessage | null {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return null;
    const value = data as Record<string, unknown>;
    if (Object.keys(value).some(key => !['type', 'nonce', 'offerId', 'revision', 'rect', 'dispose', 'overlays'].includes(key))
        || value.type !== 'zync:terminal:surface' || value.nonce !== nonce || value.offerId !== offer
        || !Number.isSafeInteger(value.revision) || (value.revision as number) <= previous
        || typeof value.dispose !== 'boolean')
        return null;
    const rect = value.rect === null ? null : parseTerminalSurfaceRect(value.rect);
    if (value.rect !== null && !rect)
        return null;
    const raw = value.overlays === undefined ? [] : value.overlays;
    if (!Array.isArray(raw) || raw.length > MAX_TERMINAL_OVERLAYS) return null;
    const overlays = raw.map(parseTerminalSurfaceRect);
    if (overlays.some(rect => !rect)) return null;
    return { type: 'zync:terminal:surface', nonce, offerId: offer, revision: value.revision as number, rect, dispose: value.dispose, overlays: overlays as TerminalSurfaceRect[] };
}
