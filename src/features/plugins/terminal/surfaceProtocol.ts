import { parseTerminalSurfaceRect, type TerminalSurfaceRect } from './surfaceGeometry.js';
export interface TerminalSurfaceMessage {
    type: 'zync:terminal:surface';
    nonce: string;
    offerId: string;
    revision: number;
    rect: TerminalSurfaceRect | null;
    dispose: boolean;
}
/** Geometry is the only iframe influence; no styles, commands or native IDs. */
export function parseTerminalSurfaceMessage(data: unknown, nonce: string, offer: string, previous: number): TerminalSurfaceMessage | null {
    if (!data || typeof data !== 'object' || Array.isArray(data))
        return null;
    const value = data as Record<string, unknown>;
    if (Object.keys(value).some(key => !['type', 'nonce', 'offerId', 'revision', 'rect', 'dispose'].includes(key))
        || value.type !== 'zync:terminal:surface' || value.nonce !== nonce || value.offerId !== offer
        || !Number.isSafeInteger(value.revision) || (value.revision as number) <= previous
        || typeof value.dispose !== 'boolean')
        return null;
    const rect = value.rect === null ? null : parseTerminalSurfaceRect(value.rect);
    if (value.rect !== null && !rect)
        return null;
    return { type: 'zync:terminal:surface', nonce, offerId: offer, revision: value.revision as number, rect, dispose: value.dispose };
}
