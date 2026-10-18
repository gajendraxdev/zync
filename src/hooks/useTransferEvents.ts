import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAppStore } from '../store/useAppStore';
import { getTransferEventProjection, type TransferProgressEvent, type TransferSuccessEvent, type TransferErrorEvent } from '../features/files/application/transferEventProjection';
import { nativeFileTransferReceipt } from '../features/files/application/nativeFileTransfer';

export function useTransferEvents() {
    useEffect(() => {
        const projection = getTransferEventProjection(useAppStore.getState, () => {
            useAppStore.getState().setLastAction('Could not refresh the transfer destination', 'error');
        });
        let disposed = false;
        const unlisteners: Array<() => void> = [];
        const register = async <T,>(name: string, handler: (payload: T) => void) => {
            try {
                const unlisten = await listen<T>(name, event => {
                    if (!disposed) handler(event.payload);
                });
                if (disposed) unlisten();
                else unlisteners.push(unlisten);
            } catch {
                if (!disposed) useAppStore.getState().setLastAction('Transfer status updates are unavailable', 'error');
            }
        };
        const receiveNative = (value: unknown) => {
            projection.native(nativeFileTransferReceipt(value));
        };
        // Subscribe before reading history. A late snapshot cannot resurrect a
        // terminal event received while that read was in flight.
        void Promise.all([
            register<TransferProgressEvent>('transfer-progress', projection.progress),
            register<TransferSuccessEvent>('transfer-success', projection.success),
            register<TransferErrorEvent>('transfer-error', projection.error),
            register<unknown>('file-transfer-started', value => {
                try { receiveNative(value); }
                catch { useAppStore.getState().setLastAction('Invalid native transfer status', 'error'); }
            }),
            register<unknown>('file-transfer-outcome', value => {
                try { receiveNative(value); }
                catch { useAppStore.getState().setLastAction('Invalid native transfer status', 'error'); }
            }),
        ]).then(async () => {
            const history: unknown = await window.ipcRenderer.invoke('fs_transfer_history');
            if (disposed) return;
            if (!Array.isArray(history) || history.length > 256) throw new Error('Invalid transfer recovery history');
            for (const value of history) useAppStore.getState().receiveNativeTransfer(nativeFileTransferReceipt(value));
        }).catch(() => {
            if (!disposed) useAppStore.getState().setLastAction('Transfer recovery history is unavailable; existing files were not modified', 'error');
        });

        return () => {
            disposed = true;
            unlisteners.forEach(unlisten => unlisten());
        };
    }, []);
}
