import { useCallback, useEffect, useRef, useState } from 'react';
import type { FolderSizeReport, FolderSizeState } from '../domain/folderSizes';

type Run = { scope: number; cancelled: boolean; id: string };
type Snapshot = { scope: number; state: FolderSizeState };

/** Inspect one selected folder only while Properties is open. Native admission,
 * cancellation and reply fencing reuse the existing bounded scanner.
 * No listing queue, background scans or persisted size cache are retained.
 */
export function useFolderSizes(connectionId: string | undefined, path: string, listing: unknown, binding: unknown,
    active: boolean, target: string | undefined) {
    const owner = useRef({ connectionId, path, listing, binding, active, target, scope: 0 });
    const previous = owner.current;
    if (previous.connectionId !== connectionId || previous.path !== path || previous.listing !== listing
        || previous.binding !== binding || previous.active !== active || previous.target !== target) {
        owner.current = { connectionId, path, listing, binding, active, target, scope: previous.scope + 1 };
    }
    const scope = owner.current.scope;
    const run = useRef<Run | null>(null);
    const startedScope = useRef(-1);
    const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
    const [inspected, setInspected] = useState<number | null>(null);
    const inspect = useCallback(() => setInspected(scope), [scope]);
    const closeDetails = useCallback(() => setInspected(null), []);
    const cancel = useCallback(() => {
        const current = run.current;
        if (!current || current.cancelled) return;
        current.cancelled = true;
        void window.ipcRenderer.invoke('fs_folder_size_cancel', { id: current.id }).catch(() => {});
        setSnapshot(old => old?.scope === current.scope ? { scope: current.scope, state: { status: 'cancelled' } } : old);
    }, []);
    useEffect(() => () => {
        if (run.current?.scope === scope) cancel();
        // Strict Mode replays mount effects; a replay needs a fresh owned request.
        if (startedScope.current === scope) startedScope.current = -1;
    }, [scope, cancel]);

    const start = useCallback(() => {
        if (!active || !connectionId || !path || !target || owner.current.scope !== scope || (run.current && !run.current.cancelled)) return;
        startedScope.current = scope;
        const current: Run = { scope, cancelled: false, id: crypto.randomUUID() };
        run.current = current;
        const owns = () => !current.cancelled && owner.current.scope === scope && run.current === current;
        /** Ignore replies from cancelled or superseded inspector selections. */
        const update = (state: FolderSizeState) => { if (owns()) setSnapshot({ scope, state }); };
        update({ status: 'calculating' });
        void (async () => {
            let completed = false;
            try {
                await window.ipcRenderer.invoke('fs_folder_size_begin', { id: current.id, connectionId });
                if (!owns()) return;
                const report: FolderSizeReport = await window.ipcRenderer.invoke('fs_folder_size_calculate', { id: current.id, connectionId, path: target });
                completed = true;
                update({ status: 'finished', report });
            } catch (error) {
                update({ status: 'unavailable', reason: String(error) });
            } finally {
                // Failed setup/cancelled admission can leave a registration; a
                // completed command has already released its native lease.
                if (!completed) void window.ipcRenderer.invoke('fs_folder_size_cancel', { id: current.id }).catch(() => {});
                if (run.current === current) run.current = null;
            }
        })();
    }, [active, connectionId, path, target, scope]);
    useEffect(() => {
        if (active && target && startedScope.current !== scope) start();
        if (!active || !target) setSnapshot(null);
    }, [active, target, scope, start]);
    const state = active && target && snapshot?.scope === scope ? snapshot.state : undefined;
    return { state, active: state?.status === 'calculating', start, cancel, inspect, closeDetails,
        details: inspected === scope ? state : undefined };
}

export type FolderSizes = ReturnType<typeof useFolderSizes>;
