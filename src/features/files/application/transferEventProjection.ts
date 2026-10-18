import { isActiveTransferStatus, type TransferSlice } from '../../../store/transferSlice';
import { isFileTransferNotStarted, isTransferCancellation, type FileTransferExecution } from './executeFileTransfer';
import { isNativeTransferActive, type NativeFileTransferReceipt } from './nativeFileTransfer';

export interface TransferProgressEvent {
    id: string;
    transferred: number;
    total: number;
}

export interface TransferSuccessEvent {
    id: string;
    destination_connection_id: string;
}

export interface TransferErrorEvent {
    id: string;
    error: string;
}

type ProjectionStore = Pick<TransferSlice,
    'transfers' | 'updateTransferProgress' | 'completeTransfer' | 'failTransfer' | 'cancelTransfer' | 'receiveNativeTransfer'> & {
    refreshConnectionFiles: (connectionId: string) => Promise<void>;
};

/** Projects native outcomes idempotently, regardless of IPC-result/event arrival order. */
export function createTransferEventProjection(getStore: () => ProjectionStore, onRefreshError: () => void) {
    const refreshedOutcomes = new Set<string>();

    const refreshDestination = (id: string, store: ProjectionStore) => {
        if (refreshedOutcomes.has(id)) return;
        const liveIds = new Set(store.transfers.map(transfer => transfer.id));
        for (const previous of refreshedOutcomes) {
            if (!liveIds.has(previous)) refreshedOutcomes.delete(previous);
        }
        const transfer = store.transfers.find(item => item.id === id);
        if (!transfer) return;
        refreshedOutcomes.add(id);
        void store.refreshConnectionFiles(transfer.destinationConnectionId).catch(onRefreshError);
    };

    return {
        native(receipt: NativeFileTransferReceipt) {
            getStore().receiveNativeTransfer(receipt);
            if (isNativeTransferActive(receipt)) return;
            const store = getStore();
            const transfer = store.transfers.find(item => item.id === receipt.id);
            const status = receipt.phase === 'completed' ? 'completed' : receipt.phase === 'cancelled' ? 'cancelled' : 'failed';
            if (transfer?.status === status) refreshDestination(receipt.id, store);
        },
        progress({ id, transferred, total }: TransferProgressEvent) {
            getStore().updateTransferProgress(id, {
                transferred, total, percentage: total > 0 ? (transferred / total) * 100 : 0,
            });
        },
        success({ id }: Pick<TransferSuccessEvent, 'id'> & Partial<TransferSuccessEvent>) {
            const store = getStore();
            const transfer = store.transfers.find(item => item.id === id);
            if (!transfer || (!isActiveTransferStatus(transfer.status) && transfer.status !== 'completed')) return;
            if (isActiveTransferStatus(transfer.status)) store.completeTransfer(id);
            refreshDestination(id, store);
        },
        error({ id, error }: TransferErrorEvent) {
            const store = getStore();
            const transfer = store.transfers.find(item => item.id === id);
            const cancelled = isTransferCancellation(error);
            const outcome = cancelled ? 'cancelled' : 'failed';
            if (!transfer || (!isActiveTransferStatus(transfer.status) && transfer.status !== outcome)) return;
            if (isActiveTransferStatus(transfer.status)) {
                if (cancelled) store.cancelTransfer(id);
                else store.failTransfer(id, error);
            }
            // A failure/cancellation may still have changed destination contents.
            if (!isFileTransferNotStarted(error)) refreshDestination(id, store);
        },
    };
}

// Share the existing projection between IPC results and native events for each
// store. Weak keys avoid retaining test/retired stores; no second transfer registry.
const projections = new WeakMap<() => ProjectionStore, ReturnType<typeof createTransferEventProjection>>();

export function getTransferEventProjection(getStore: () => ProjectionStore, onRefreshError: () => void) {
    let projection = projections.get(getStore);
    if (!projection) {
        projection = createTransferEventProjection(getStore, onRefreshError);
        projections.set(getStore, projection);
    }
    return projection;
}

/** Bind existing store actions once, without coupling the transfer core to React or IPC globals. */
export function createFileTransferExecution(invoke: FileTransferExecution['invoke'],
    getStore: () => ProjectionStore & { setLastAction: (message: string, type: 'error') => void }): FileTransferExecution {
    const projection = getTransferEventProjection(getStore, () => getStore().setLastAction('Could not refresh the transfer destination', 'error'));
    return { invoke, completeTransfer: id => projection.success({ id }),
        // A request may fail before mutation (e.g. busy admission); native
        // terminal events own refresh for failures without a staged receipt.
        failTransfer: getStore().failTransfer,
        cancelTransfer: id => projection.error({ id, error: 'Cancelled' }), receiveNativeTransfer: projection.native };
}

/** Clear history through the existing journal without deleting any filesystem artifacts. */
export async function dismissTransferReceipt(id: string, invoke: FileTransferExecution['invoke'],
    getStore: () => Pick<TransferSlice, 'transfers' | 'removeTransfer'>): Promise<void> {
    const transfer = getStore().transfers.find(item => item.id === id);
    if (!transfer || isActiveTransferStatus(transfer.status)) return;
    if (transfer.nativeRecovery) {
        await invoke('fs_transfer_dismiss', { transferId: id });
    }
    getStore().removeTransfer(id);
}
