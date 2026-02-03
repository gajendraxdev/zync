import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../store/useAppStore';

interface FsOperationEvent {
    op: string;
    connection_id: string;
    path: string;
    status: 'success' | 'error';
    error?: string;
}

export function useFileSystemEvents() {
    useEffect(() => {
        const unlisten = listen<FsOperationEvent>('fs-operation', (event) => {
            const { op, connection_id, status, error, path } = event.payload;
            const store = useAppStore.getState();

            if (status === 'success') {
                // Determine action message
                const name = path.split('/').pop() || path;
                let message = '';
                if (op === 'delete') message = `Deleted "${name}"`;
                else if (op === 'copy') message = `Copied "${name}"`;
                else if (op === 'rename') message = `Renamed to "${name}"`;
                else if (op === 'upload') message = `Uploaded "${name}"`;

                store.setLastAction(message, 'success');
                store.refreshFiles(connection_id);
            } else {
                // Error handling
                store.setLastAction(`Operation failed: ${error}`, 'error');
                // Refresh just in case to show true state
                store.refreshFiles(connection_id);
            }
        });

        return () => {
            unlisten.then(f => f());
        };
    }, []);
}
