import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_FOLDER_SIZE_BATCH, type FolderSizeReport, type FolderSizeState } from '../domain/folderSizes';

type Run = { scope: number; cancelled: boolean; id?: string };
type Snapshot = { scope: number; states: Record<string, FolderSizeState>; active: boolean; limited: boolean };
const EMPTY: Record<string, FolderSizeState> = {};

/** Surface-owned sequential queue. Results are ephemeral and invalidated
 * by refresh, navigation, disconnect or connection replacement; selection does
 * not restart work. Default-on automatic work runs once per settled listing;
 * disabling the preference fences replies and cancels queued/native work.
 * Acknowledged admission makes cancellation safe during IPC setup.
 */
export function useFolderSizes(connectionId: string | undefined, path: string, listing: unknown, binding: unknown,
    active: boolean, enabled: boolean, paths: readonly string[]) {
    const owner = useRef({ connectionId, path, listing, binding, active, enabled, scope: 0 });
    const previous = owner.current;
    if (previous.connectionId !== connectionId || previous.path !== path || previous.listing !== listing
        || previous.binding !== binding || previous.active !== active || previous.enabled !== enabled) {
        owner.current = { connectionId, path, listing, binding, active, enabled, scope: previous.scope + 1 };
    }
    const scope = owner.current.scope;
    const run = useRef<Run | null>(null);
    const automaticScope = useRef(-1);
    const [snapshot, setSnapshot] = useState<Snapshot>({ scope: -1, states: EMPTY, active: false, limited: false });
    const [inspected, setInspected] = useState<{ scope: number; path: string } | null>(null);
    const inspect = useCallback((target: string) => setInspected({ scope, path: target }), [scope]);
    const closeDetails = useCallback(() => setInspected(null), []);
    const cancel = useCallback(() => {
        const current = run.current;
        if (!current) return;
        current.cancelled = true;
        if (current.id) void window.ipcRenderer.invoke('fs_folder_size_cancel', { id: current.id }).catch(() => {});
        setSnapshot(old => ({ ...old, active: false, states: Object.fromEntries(Object.entries(old.states)
            .map(([key, value]) => [key, value.status === 'queued' || value.status === 'calculating' ? { status: 'cancelled' } : value])) }));
    }, []);
    useEffect(() => () => { if (run.current?.scope === scope) cancel(); }, [scope, cancel]);

    const start = useCallback((paths: readonly string[]) => {
        if (!active || !enabled || !connectionId || !path || owner.current.scope !== scope || (run.current && !run.current.cancelled)) return;
        const selected = [...new Set(paths.slice(0, MAX_FOLDER_SIZE_BATCH))];
        if (!selected.length) return;
        automaticScope.current = scope;
        const current: Run = { scope, cancelled: false };
        run.current = current;
        const owns = () => !current.cancelled && owner.current.scope === scope && run.current === current;
        const update = (target: string, value: FolderSizeState) => {
            if (owns()) setSnapshot(old => ({ ...old, states: { ...old.states, [target]: value } }));
        };
        setSnapshot(old => {
            const sameScope = old.scope === scope;
            return { scope, active: true, limited: (sameScope && old.limited) || paths.length > MAX_FOLDER_SIZE_BATCH,
                states: { ...(sameScope ? old.states : EMPTY),
                    ...Object.fromEntries(selected.map(target => [target, { status: 'queued' as const }])) } };
        });
        void (async () => {
            for (const target of selected) {
                if (!owns()) break;
                const id = crypto.randomUUID();
                current.id = id;
                let completed = false;
                try {
                    await window.ipcRenderer.invoke('fs_folder_size_begin', { id, connectionId });
                    if (!owns()) break;
                    update(target, { status: 'calculating' });
                    const report: FolderSizeReport = await window.ipcRenderer.invoke('fs_folder_size_calculate', { id, connectionId, path: target });
                    completed = true;
                    update(target, { status: 'finished', report });
                } catch (error) {
                    update(target, { status: 'unavailable', reason: String(error) });
                } finally {
                    // Failed setup or cancellation may leave an unclaimed registration.
                    // A completed command already released its native lease.
                    if (!completed) void window.ipcRenderer.invoke('fs_folder_size_cancel', { id }).catch(() => {});
                    if (current.id === id) current.id = undefined;
                }
            }
            if (owns()) setSnapshot(old => ({ ...old, active: false }));
            if (run.current === current) run.current = null;
        })();
    }, [active, enabled, connectionId, path, scope]);
    useEffect(() => {
        if (!active || !enabled || !paths.length || automaticScope.current === scope) return;
        // Coalesce a settling listing; sorting/selection/results never restart a
        // completed, partial or cancelled batch. Existing budgets still apply.
        const timer = setTimeout(() => { if (automaticScope.current !== scope) start(paths); }, 250);
        return () => clearTimeout(timer);
    }, [active, enabled, paths, scope, start]);
    const visible = snapshot.scope === scope && active && enabled;
    const detailState = visible && inspected?.scope === scope ? snapshot.states[inspected.path] : undefined;
    return { states: visible ? snapshot.states : EMPTY, active: visible && snapshot.active, enabled,
        limited: visible && snapshot.limited, start, cancel, inspect, closeDetails,
        details: detailState };
}

export type FolderSizes = ReturnType<typeof useFolderSizes>;
