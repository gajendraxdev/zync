import type { StateCreator } from 'zustand';
import { track } from '../features/usage';
import { isNativeTransferActive, isNativeTransferResolved, type NativeFileTransferReceipt } from '../features/files/application/nativeFileTransfer';

export type TransferStatus = 'pending' | 'transferring' | 'cancelling' | 'completed' | 'failed' | 'cancelled';

// In-memory history only; unsuccessful outcomes and recovery warnings require dismissal.
const MAX_COMPLETED_TRANSFERS = 20;

/** A cancellation request remains active until the native operation reports its outcome. */
export function isActiveTransferStatus(status: TransferStatus): boolean {
    return status === 'pending' || status === 'transferring' || status === 'cancelling';
}

export interface Transfer {
    id: string;
    sourceConnectionId: string;
    sourcePath: string;
    destinationConnectionId: string;
    destinationPath: string;
    status: TransferStatus;
    progress: {
        transferred: number;
        total: number;
        percentage: number;
    };
    error?: string;
    /** Possible retained original for an overwrite; never automatically remove it after failure. */
    recoveryBackupPath?: string;
    /** A confirmed write may still require recovery-backup cleanup. */
    recoveryWarning?: string;
    recoveryStagePath?: string;
    nativeRecovery?: boolean;
    destinationUnchanged?: boolean;
    stageCleaned?: boolean;
    startTime: number;
    lastUpdated: number;
    speed: number; // bytes per second
    speedBaseline: number; // transferred value at the start of the current speed window
    label?: string; // optional custom phase label (e.g. 'Compressing')
}

/** Only clean successful receipts may expire or count toward the bounded history. */
export function isExpiringTransferReceipt(transfer: Transfer): boolean {
    return transfer.status === 'completed' && !transfer.recoveryBackupPath && !transfer.recoveryWarning;
}

export interface TransferSlice {
    transfers: Transfer[];
    addTransfer: (transfer: Omit<Transfer, 'id' | 'status' | 'progress' | 'startTime' | 'lastUpdated' | 'speed' | 'speedBaseline'>) => string;
    updateTransferProgress: (id: string, progress: Transfer['progress']) => void;
    completeTransfer: (id: string) => void;
    failTransfer: (id: string, error: string) => void;
    requestTransferCancellation: (id: string) => void;
    cancelTransfer: (id: string) => void;
    setTransferRecovery: (id: string, recovery: { backupPath: string; warning: string } | null) => void;
    removeTransfer: (id: string) => void;
    receiveNativeTransfer: (receipt: NativeFileTransferReceipt) => void;
}

/** Ignore unknown IDs and terminal records, including late or duplicate native messages. */
function updateActiveTransfer(
    state: TransferSlice,
    id: string,
    update: (transfer: Transfer) => Transfer,
): TransferSlice | Pick<TransferSlice, 'transfers'> {
    const index = state.transfers.findIndex(transfer => transfer.id === id);
    const transfer = state.transfers[index];
    if (!transfer || !isActiveTransferStatus(transfer.status)) return state;
    const next = update(transfer);
    if (next === transfer) return state;
    const transfers = [...state.transfers];
    transfers[index] = next;
    return { transfers };
}

function retainCompletedTransfers(transfers: Transfer[], completedId: string, onDiscard: (id: string) => void): Transfer[] {
    let excess = transfers.filter(isExpiringTransferReceipt).length - MAX_COMPLETED_TRANSFERS;
    if (excess <= 0) return transfers;
    return transfers.filter(transfer => {
        if (excess <= 0 || transfer.id === completedId || !isExpiringTransferReceipt(transfer)) return true;
        excess -= 1;
        onDiscard(transfer.id);
        return false;
    });
}

export const createTransferSlice: StateCreator<TransferSlice> = (set) => {
    // Match the visible-history bound. Late IPC/history snapshots must
    // not recreate rows removed after verified cleanup or acknowledgement.
    const dismissed = new Set<string>();
    const rememberDismissed = (id: string) => {
        dismissed.add(id);
        if (dismissed.size > 256) dismissed.delete(dismissed.values().next().value!);
    };
    return {
        transfers: [],

        receiveNativeTransfer: receipt => {
            let completed = false;
            set(state => {
                const previous = state.transfers.find(transfer => transfer.id === receipt.id);
                if (dismissed.has(receipt.id) || !previous && isNativeTransferResolved(receipt)) return state;
                const active = isNativeTransferActive(receipt);
                const status: TransferStatus = active ? previous?.status === 'cancelling' ? 'cancelling' : 'transferring' : receipt.phase === 'completed' ? 'completed'
                    : receipt.phase === 'cancelled' ? 'cancelled' : 'failed';
                // An old history snapshot must not resurrect a terminal live receipt.
                if (previous && !isActiveTransferStatus(previous.status) && active) return state;
                if (previous?.nativeRecovery && !isActiveTransferStatus(previous.status) && previous.status !== status) return state;
                if (previous?.stageCleaned && !receipt.stageCleaned) return state;
                completed = Boolean(previous && isActiveTransferStatus(previous.status) && status === 'completed');
                const transferred = active ? Math.max(previous?.progress.transferred ?? 0, receipt.transferred) : receipt.transferred;
                const total = active ? Math.max(previous?.progress.total ?? 0, receipt.total) : receipt.total;
                const transfer: Transfer = {
                    ...previous, id: receipt.id, sourceConnectionId: receipt.sourceConnectionId, sourcePath: receipt.sourcePath,
                    destinationConnectionId: receipt.destinationConnectionId, destinationPath: receipt.destinationPath,
                    status, progress: { transferred, total,
                        percentage: status === 'completed' ? 100 : total > 0 ? Math.min(100, transferred / total * 100) : 0 },
                    error: receipt.error ?? undefined, recoveryWarning: receipt.warning ?? undefined,
                    recoveryStagePath: receipt.stageCleaned || status === 'completed' && !receipt.warning ? undefined : receipt.stagePath,
                    recoveryBackupPath: receipt.backupExpected && !receipt.destinationUnchanged && (status !== 'completed' || receipt.warning) ? receipt.backupPath : undefined,
                    destinationUnchanged: receipt.destinationUnchanged, stageCleaned: receipt.stageCleaned ?? false, nativeRecovery: true,
                    startTime: previous?.startTime ?? receipt.createdAt, lastUpdated: Date.now(), speed: previous?.speed ?? 0,
                    speedBaseline: previous?.speedBaseline ?? 0,
                };
                const transfers = previous ? state.transfers.map(item => item.id === receipt.id ? transfer : item) : [...state.transfers, transfer];
                return { transfers: retainCompletedTransfers(transfers, receipt.id, rememberDismissed) };
            });
            if (completed) track('file_transfer');
        },

        addTransfer: (transfer: Omit<Transfer, 'id' | 'status' | 'progress' | 'startTime' | 'lastUpdated' | 'speed' | 'speedBaseline'>) => {
            const id = crypto.randomUUID();
            const now = Date.now();
            const newTransfer: Transfer = {
                ...transfer,
                id,
                status: 'pending',
                progress: { transferred: 0, total: 0, percentage: 0 },
                startTime: now,
                lastUpdated: now,
                speed: 0,
                speedBaseline: 0,
            };
            set(state => ({ transfers: [...state.transfers, newTransfer] }));
            return id;
        },

        updateTransferProgress: (id: string, progress: Transfer['progress']) => {
            const now = Date.now();
            set(state => updateActiveTransfer(state, id, t => {
                const status = t.status === 'cancelling' ? 'cancelling' : 'transferring';

                const timeDiff = (now - t.lastUpdated) / 1000;
                let newSpeed = t.speed;

                if (timeDiff >= 0.5) {
                    // Progress updates every event; the byte/time speed baseline advances together.
                    const bytesDiff = progress.transferred - t.speedBaseline;
                    const currentSpeed = bytesDiff / timeDiff;

                    if (t.speed === 0) {
                        newSpeed = currentSpeed;
                    } else {
                        newSpeed = (t.speed * 0.7) + (currentSpeed * 0.3);
                    }

                    return { ...t, status, progress, speed: newSpeed, lastUpdated: now, speedBaseline: progress.transferred };
                }

                return { ...t, status, progress };
            }));
        },

        completeTransfer: (id: string) => {
            let completed = false;
            set(state => {
                const next = updateActiveTransfer(state, id, transfer => {
                    completed = true;
                    return {
                        ...transfer,
                        status: 'completed',
                        progress: {
                            ...transfer.progress,
                            percentage: 100,
                        },
                    };
                });
                return next === state ? state : { transfers: retainCompletedTransfers(next.transfers, id, rememberDismissed) };
            });
            if (completed) track('file_transfer');
        },

        failTransfer: (id: string, error: string) => {
            set(state => updateActiveTransfer(state, id, transfer => ({ ...transfer, status: 'failed', error })));
        },

        requestTransferCancellation: (id: string) => {
            set(state => updateActiveTransfer(state, id, transfer => (
                transfer.status === 'cancelling' ? transfer : { ...transfer, status: 'cancelling' }
            )));
        },

        cancelTransfer: (id: string) => {
            set(state => updateActiveTransfer(state, id, transfer => ({ ...transfer, status: 'cancelled' })));
        },

        setTransferRecovery: (id, recovery) => {
            set(state => {
                const index = state.transfers.findIndex(transfer => transfer.id === id);
                const transfer = state.transfers[index];
                if (!transfer) return state;
                const recoveryBackupPath = recovery?.backupPath;
                const recoveryWarning = recovery?.warning;
                if (transfer.recoveryBackupPath === recoveryBackupPath && transfer.recoveryWarning === recoveryWarning) return state;
                const transfers = [...state.transfers];
                transfers[index] = { ...transfer, recoveryBackupPath, recoveryWarning };
                // Cleanup changes receipt metadata, never the native transfer outcome.
                return { transfers: retainCompletedTransfers(transfers, id, rememberDismissed) };
            });
        },

        removeTransfer: (id: string) => {
            rememberDismissed(id);
            set(state => ({
                transfers: state.transfers.filter((t: Transfer) => t.id !== id)
            }));
        }
    };
};
