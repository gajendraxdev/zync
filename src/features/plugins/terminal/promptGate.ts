import { allocateTerminalSurface, type TerminalSurfaceRect } from './surfaceGeometry';

/** One confirmation per proposal, only when its trusted surface is usable. */
export class TerminalPromptGate {
    private readonly prompted = new WeakSet<object>();

    take(offer: object | null, state: {
        active: boolean; focused: boolean; closed: boolean; busy: boolean;
        rect: TerminalSurfaceRect | null;
        viewport: { width: number; height: number };
    }): boolean {
        if (!offer || this.prompted.has(offer) || !state.active || !state.focused || state.closed || state.busy)
            return false;
        const allocation = state.rect && allocateTerminalSurface(state.rect, state.viewport);
        if (!allocation || allocation.clip.width < 240 || allocation.clip.height < 100)
            return false;
        this.prompted.add(offer);
        return true;
    }
}
