import { useCallback, useEffect, useRef, useState } from 'react';
import { fileActionAvailability, fileActionBlocked, type FileAccessAction, type FileAccessEvidence } from '../domain/filePermissions';

const EVIDENCE_LIFETIME_MS = 15_000;

/** A surface-scoped, read-only advisory owner. One native read at a time;
 * selection churn coalesces to the newest request. Nothing is persisted, no rows
 * are probed, and SFTP stays unknown except for an observed listing denial. Expired or
 * mismatched evidence is immediately attemptable, not a stale permission lock.
 */
export function useFileActionAccess(
    connectionId: string | undefined,
    directory: string,
    target: string | null,
    active: boolean,
    listing: unknown,
    readDeniedPath?: string,
) {
    const key = JSON.stringify([connectionId, directory, target]);
    const [revision, setRevision] = useState(0);
    const [result, setResult] = useState<{ scope: number; evidence: FileAccessEvidence; expires: number } | null>(null);
    const generation = useRef(0);
    const pending = useRef<{ scope: number; started: number; promise: Promise<FileAccessEvidence> } | null>(null);
    const current = useRef({ key, active, listing, revision, scope: 0 });
    const previous = current.current;
    if (previous.key !== key || previous.active !== active || previous.listing !== listing || previous.revision !== revision) {
        current.current = { key, active, listing, revision, scope: previous.scope + 1 };
    }
    const scope = current.current.scope;

    useEffect(() => {
        const request = ++generation.current;
        // Unknown/unsupported models need no command, shell or metadata probing.
        if (!active || connectionId !== 'local' || !directory) return;
        let expiry: ReturnType<typeof setTimeout> | undefined;
        const owns = () => request === generation.current && current.current.active && current.current.scope === scope;
        const timer = setTimeout(() => {
            void (async () => {
                let read: typeof pending.current = null;
                try {
                    const preceding = pending.current;
                    if (preceding && preceding.scope !== scope) {
                        try { await preceding.promise; } catch { /* Read failures remain unknown. */ }
                        if (pending.current === preceding) pending.current = null;
                        if (!owns()) return;
                    }
                    read = pending.current;
                    if (!read) {
                        read = { scope, started: performance.now(), promise: window.ipcRenderer.invoke('fs_permissions_access', { connectionId, directory, target }) };
                        pending.current = read;
                    }
                    const evidence = await read.promise;
                    const expires = read.started + EVIDENCE_LIFETIME_MS;
                    if (!owns() || expires <= performance.now() || evidence.directory !== directory || evidence.target !== target) return;
                    setResult({ scope, evidence, expires });
                    // Timer rounding may fire just before the deadline. Clear
                    // this owner's evidence instead of merely requesting a render.
                    expiry = setTimeout(() => { if (owns()) setResult(null); }, Math.max(0, expires - performance.now()));
                } catch { /* Access inspection is advisory, never an error toast or denial. */ }
                finally { if (pending.current === read) pending.current = null; }
            })();
        }, 80);
        return () => { generation.current++; clearTimeout(timer); clearTimeout(expiry); };
    }, [key, active, listing, revision]);

    const evidence = active && result?.scope === scope && result.expires > performance.now() ? result.evidence : null;
    const evidenceRef = useRef(result);
    evidenceRef.current = active && evidence ? result : null;
    // Refresh clears the old denial synchronously, before the new check starts.
    const refresh = useCallback(() => { evidenceRef.current = null; setResult(null); setRevision(value => value + 1); }, []);
    const blocked = useCallback((action: FileAccessAction, path?: string) => {
        const now = current.current;
        // An actual failed read applies only to that exact directory, not its
        // siblings, child contents, or the parent rights needed to move it.
        if (now.active && now.scope === scope && action === 'read' && readDeniedPath
            && (path ?? target) === readDeniedPath) return true;
        const snapshot = evidenceRef.current;
        if (!snapshot || !now.active || now.scope !== scope || snapshot.expires <= performance.now()
            || snapshot.scope !== now.scope
            || (path != null && path !== snapshot.evidence.target)) return false;
        return fileActionBlocked(fileActionAvailability(snapshot.evidence, action));
    }, [scope, readDeniedPath, target]);
    const labels: [FileAccessAction, string][] = [['createFile', 'Create files'], ['createFolder', 'Create folders'],
        ['read', 'Read'], ['write', 'Save'], ['rename', 'Rename'], ['delete', 'Delete']];
    const unavailable = labels.filter(([action]) => blocked(action)).map(([, label]) => label).join(', ');
    return { blocked, unavailable, refresh };
}
