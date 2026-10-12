import type { DockPayload } from '../../../lib/paneLayout';
import type { DockTarget } from './hit';

export type TabDockLive = {
    payload: DockPayload;
    contextId?: string;
    target: DockTarget | null;
    /** Transient ownership prevents stale adapter cleanup from stopping a replacement. */
    owner?: symbol;
};

let live: TabDockLive | null = null;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

export function getTabDockLive(): TabDockLive | null {
    return live;
}

export function subscribeTabDock(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function startTabDock(payload: DockPayload, contextId?: string, owner?: symbol): void {
    live = { payload, contextId, target: null, owner };
    emit();
}

export function patchTabDockTarget(target: DockTarget | null): void {
    if (!live) return;
    if (sameTarget(live.target, target)) return;
    live = { ...live, target };
    emit();
}

export function stopTabDock(): TabDockLive | null {
    const previous = live;
    if (!live) return previous;
    live = null;
    emit();
    return previous;
}

function sameTarget(a: DockTarget | null, b: DockTarget | null): boolean {
    if (a === b) return true;
    if (!a || !b) return false;
    return ((a.kind === 'region' && b.kind === 'region' && a.region === b.region)
        || (a.kind === 'pane' && b.kind === 'pane' && a.paneId === b.paneId && a.contentId === b.contentId && a.edge === b.edge))
        && a.preview.left === b.preview.left
        && a.preview.top === b.preview.top
        && a.preview.width === b.preview.width
        && a.preview.height === b.preview.height;
}
