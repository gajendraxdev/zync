import { useCallback, useEffect, useRef, useState } from 'react';
import { acquireFileDestination } from './fileDestinationReservations';
import { modeEditAvailability, ordinaryMode, parseOrdinaryMode, permissionMasks, type FilePermissionMetadata, type FilePermissionOutcome } from '../domain/filePermissions';

interface PermissionTarget { connectionId: string; path: string }
interface EditorState {
    target: PermissionTarget;
    metadata: FilePermissionMetadata | null;
    loading: boolean;
    applying: boolean;
    editing: boolean;
    draft: string;
    message: string;
    error: string;
    needsRefresh: boolean;
}

const sameTarget = (first: PermissionTarget | null, second: PermissionTarget | null) =>
    first?.connectionId === second?.connectionId && first?.path === second?.path;

/** One Properties owner, shared by inline/modal presentation. Work is explicit,
 * replies are target-fenced, writes use existing reservations and never replay.
 * Closing hides the draft; it does not cancel an already submitted native change.
 */
export function useFilePermissionEditor(
    target: PermissionTarget | null,
    active: boolean,
    refreshListings: (connectionId: string) => Promise<void>,
) {
    const [state, setState] = useState<EditorState | null>(null);
    const current = useRef({ target, active });
    current.current = { target, active };
    const generation = useRef(0);
    const pendingApply = useRef(false);
    const pendingRead = useRef<{ target: PermissionTarget; promise: Promise<FilePermissionMetadata> } | null>(null);
    const mounted = useRef(true);
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

    const refresh = useCallback(async () => {
        if (!target || !active || pendingApply.current) return;
        const captured = target;
        const request = ++generation.current;
        const ownsReply = () => mounted.current && generation.current === request
            && current.current.active && sameTarget(current.current.target, captured);
        setState({ target: captured, metadata: null, loading: true, applying: false,
            editing: false, draft: '', message: '', error: '', needsRefresh: false });
        let read: typeof pendingRead.current = null;
        try {
            // Coalesce selection churn behind the one outstanding native read.
            // Stale waiters exit before issuing another request; latest target wins.
            const preceding = pendingRead.current;
            if (preceding && !sameTarget(preceding.target, captured)) {
                try { await preceding.promise; } catch { /* The preceding owner reports its own error. */ }
                if (pendingRead.current === preceding) pendingRead.current = null;
                if (!ownsReply()) return;
            }
            // StrictMode/repeated refreshes share only the identical in-flight read;
            // there is no persistent cache and no per-list-row permission probing.
            read = pendingRead.current;
            if (!read || !sameTarget(read.target, captured)) {
                read = { target: captured, promise: window.ipcRenderer.invoke('fs_permissions_read', captured) };
                pendingRead.current = read;
            }
            const metadata = await read.promise;
            if (!ownsReply()) return;
            if (metadata.path !== captured.path) throw new Error('Permission metadata did not match the selected item.');
            setState(previous => previous && ({ ...previous, loading: false, metadata,
                draft: metadata.snapshot.mode == null ? '' : ordinaryMode(metadata.snapshot.mode) }));
        } catch (error) {
            if (ownsReply()) setState(previous => previous && ({ ...previous, loading: false, error: String(error), needsRefresh: true }));
        } finally {
            if (pendingRead.current === read) pendingRead.current = null;
        }
    }, [target?.connectionId, target?.path, active]);
    const refreshCurrent = useRef(refresh);
    refreshCurrent.current = refresh;

    useEffect(() => {
        if (active) void refresh();
        else {
            generation.current++;
            setState(previous => previous && ({ ...previous, editing: false }));
        }
        return () => { generation.current++; };
    }, [refresh, active]);

    const visible = state && sameTarget(state.target, target) ? state : null;
    const apply = async () => {
        if (!active || pendingApply.current || !visible?.metadata || visible.needsRefresh || !visible.editing) return;
        const captured = visible.target;
        const metadata = visible.metadata;
        if (metadata.snapshot.mode == null || parseOrdinaryMode(visible.draft) == null
            || modeEditAvailability(metadata).state === 'unsupported') return;
        const masks = permissionMasks(metadata.snapshot.mode!, visible.draft);
        const request = ++generation.current;
        pendingApply.current = true;
        setState(previous => previous && ({ ...previous, applying: true, error: '', message: '' }));
        let reservation: ReturnType<typeof acquireFileDestination> | undefined;
        try {
            reservation = acquireFileDestination(captured.connectionId, captured.path);
            const outcome: FilePermissionOutcome = await window.ipcRenderer.invoke('fs_permissions_apply', {
                connectionId: captured.connectionId, expected: metadata, ...masks,
            });
            if (mounted.current && generation.current === request && sameTarget(current.current.target, captured)) {
                setState(previous => previous && ({ ...previous, metadata: outcome.metadata ?? metadata,
                    draft: outcome.metadata?.snapshot.mode == null ? previous.draft : ordinaryMode(outcome.metadata.snapshot.mode),
                    applying: false, editing: false, needsRefresh: outcome.status !== 'verified',
                    message: outcome.message }));
            }
            // Refresh the captured endpoint, never whichever pane/host is active now.
            if (outcome.status === 'verified' || outcome.status === 'adjusted') {
                // Listing reconciliation is not mutation acknowledgement. Do not
                // keep the editor locked, or turn a verified chmod into a failure.
                void Promise.resolve().then(() => refreshListings(captured.connectionId)).catch(error => {
                    if (mounted.current && generation.current === request && sameTarget(current.current.target, captured)) {
                        setState(previous => previous && !previous.editing
                            ? { ...previous, message: `${outcome.message} Folder listing refresh failed: ${String(error)}` } : previous);
                    }
                });
            }
        } catch (error) {
            if (mounted.current && generation.current === request && sameTarget(current.current.target, captured)) {
                setState(previous => previous && ({ ...previous, applying: false, needsRefresh: true, error: String(error) }));
            }
        } finally {
            reservation?.release();
            pendingApply.current = false;
            // Even closing Properties cannot leave the captured owner stuck applying.
            if (mounted.current) setState(previous => previous && sameTarget(previous.target, captured)
                ? { ...previous, applying: false } : previous);
            if (mounted.current && generation.current !== request && current.current.active) void refreshCurrent.current();
        }
    };

    return {
        active,
        state: visible,
        refresh,
        apply,
        edit: () => setState(previous => previous?.metadata && !previous.needsRefresh && !pendingApply.current
            && modeEditAvailability(previous.metadata).state !== 'unsupported'
            ? { ...previous, editing: true, message: '', error: '' } : previous),
        discard: () => setState(previous => previous && !pendingApply.current
            ? { ...previous, editing: false, draft: previous.metadata?.snapshot.mode == null ? '' : ordinaryMode(previous.metadata.snapshot.mode) } : previous),
        setDraft: (draft: string) => setState(previous => previous && !pendingApply.current ? { ...previous, draft } : previous),
    };
}

export type FilePermissionEditor = ReturnType<typeof useFilePermissionEditor>;
