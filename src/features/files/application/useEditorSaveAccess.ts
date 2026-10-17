import { useCallback, useEffect, useRef, useState } from 'react';
import type { FilePermissionMetadata } from '../domain/filePermissions';
import {
    EditorSaveBlockedError, editorSaveBlocked, editorSaveErrorMessage, editorSavePolicy,
    isEditorWriteDenied, uncheckedEditorSavePolicy, type EditorSaveAccess, type EditorSavePolicy,
} from '../domain/editorSaveAccess';

export interface EditorPermissionTarget { connectionId: string; path: string }
const checking: EditorSavePolicy = { state: 'checking', reason: 'Checking file permissions…', overridable: false };

/** One editor-document owner for every provider. Reads reuse the native metadata
 * inspector; no write probes, persistent cache or automatic write retry.
 * Refresh/late save replies cannot change another document's access or draft.
 */
export function useEditorSaveAccess(target: EditorPermissionTarget | undefined, onSave: (content: string) => Promise<void>) {
    const key = target ? JSON.stringify([target.connectionId, target.path]) : '';
    const [observed, setObserved] = useState({ key, policy: target ? checking : uncheckedEditorSavePolicy });
    const policy = observed.key === key ? observed.policy : target ? checking : uncheckedEditorSavePolicy;
    const current = useRef({ key, policy, onSave });
    current.current = { key, policy, onSave };
    const generation = useRef(0);
    const pending = useRef<{ key: string; promise: Promise<FilePermissionMetadata> } | null>(null);

    const updatePolicy = useCallback((value: EditorSavePolicy) => {
        current.current.policy = value;
        setObserved({ key: current.current.key, policy: value });
    }, []);

    const refresh = useCallback(async () => {
        if (!target || current.current.key !== key) return;
        const request = ++generation.current;
        updatePolicy(checking);
        const ownsReply = () => request === generation.current && current.current.key === key;
        let read = pending.current;
        // StrictMode and repeated explicit refreshes share only an in-flight read.
        try {
            if (read && read.key !== key) {
                try { await read.promise; } catch { /* Its captured owner handles the failure. */ }
                if (pending.current === read) pending.current = null;
                if (!ownsReply()) return;
                read = pending.current;
            }
            if (!read) {
                read = { key, promise: window.ipcRenderer.invoke('fs_permissions_read', target) };
                pending.current = read;
            }
            const metadata = await read.promise;
            if (!ownsReply()) return;
            updatePolicy(metadata.path === target.path ? editorSavePolicy(metadata) : uncheckedEditorSavePolicy);
        } catch {
            if (ownsReply()) updatePolicy(uncheckedEditorSavePolicy);
        } finally {
            if (pending.current === read) pending.current = null;
        }
    }, [key, updatePolicy]);

    useEffect(() => {
        void refresh();
        return () => { generation.current++; };
    }, [refresh]);

    const save = useCallback(async (content: string) => {
        const captured = current.current;
        if (captured.key !== key) throw new EditorSaveBlockedError('The editor document changed.');
        if (editorSaveBlocked(captured.policy)) throw new EditorSaveBlockedError(captured.policy.reason);
        try {
            await captured.onSave(content);
        } catch (error) {
            if (error instanceof EditorSaveBlockedError) throw error;
            if (current.current.key === captured.key && isEditorWriteDenied(error)) {
                // Invalidates an in-flight inspection too: an observed denial
                // must not be overwritten by older, more optimistic metadata.
                generation.current++;
                updatePolicy({ state: 'readOnly', reason: 'Writing was denied by the filesystem. Check permissions before trying again.', overridable: false });
            }
            throw new Error(`Failed to save file: ${editorSaveErrorMessage(error)}`);
        }
    }, [key, updatePolicy]);

    const access: EditorSaveAccess = {
        ...policy,
        refresh: () => { void refresh(); },
        enableSaving: () => {
            if (current.current.key === key && current.current.policy.overridable) updatePolicy(uncheckedEditorSavePolicy);
        },
    };
    return { access, save };
}
