import { acquireFileDestination, assertFileDestinationReservation, fileDestinationPathsOverlap, type FileDestinationReservation } from './fileDestinationReservations';
import { isNativeTransferActive, nativeFileTransferReceipt, type NativeFileTransferReceipt } from './nativeFileTransfer';

export interface FileTransferRequest {
    transferId: string;
    sourceConnectionId: string;
    sourcePath: string;
    destinationConnectionId: string;
    destinationPath: string;
    overwrite?: boolean;
    folderMode?: 'replace' | 'combine';
}

export interface FileTransferExecution {
    invoke: (command: string, args: Record<string, unknown>) => Promise<unknown>;
    completeTransfer: (id: string) => void;
    failTransfer: (id: string, error: string) => void;
    cancelTransfer: (id: string) => void;
    receiveNativeTransfer?: (receipt: NativeFileTransferReceipt) => void;
}

export function transferErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
        return error.message;
    }
    return String(error);
}

// Native preparation is read-only. Keep this tag until presentation so an early
// failure is not mistaken for a partially written target or a recovery receipt.
const NOT_STARTED_PREFIX = 'TRANSFER_NOT_STARTED:';

export function isFileTransferNotStarted(error: unknown): boolean {
    return transferErrorMessage(error).startsWith(NOT_STARTED_PREFIX);
}

export function fileTransferFailureMessage(error: unknown): string {
    if (error === undefined || error === null) return '';
    const message = transferErrorMessage(error);
    return isFileTransferNotStarted(error)
        ? `Copy did not start; destination unchanged. ${message.slice(NOT_STARTED_PREFIX.length)}`
        : message;
}

/** Legacy native cancellation is an exact outcome, not any error mentioning cancel. */
export function isTransferCancellation(error: unknown): boolean {
    return transferErrorMessage(error) === 'Cancelled';
}

/** One outcome owner for staged copies, legacy fallbacks and preparation failures. */
async function runFileTransfer(request: FileTransferRequest, execution: FileTransferExecution,
    borrowedReservation: FileDestinationReservation | undefined, stagedOnly: boolean): Promise<boolean> {
    const { transferId, sourceConnectionId, sourcePath, destinationConnectionId, destinationPath } = request;
    let ownedReservation: FileDestinationReservation | undefined;
    let outcomeReported = false;
    try {
        if (sourceConnectionId === 'local' && destinationConnectionId === 'local'
            && fileDestinationPathsOverlap(sourcePath, destinationPath)) {
            throw new Error('Source and destination paths overlap; the original was left unchanged');
        }
        if (borrowedReservation) assertFileDestinationReservation(borrowedReservation, destinationConnectionId, destinationPath);
        else ownedReservation = acquireFileDestination(destinationConnectionId, destinationPath);
        const receipt = await invokeStagedFileTransfer(request, execution.invoke);
        if (receipt) {
            const error = receipt.phase === 'cancelled' ? 'Cancelled'
                : receipt.error ?? receipt.warning ?? 'Transfer needs recovery inspection';
            if (execution.receiveNativeTransfer) execution.receiveNativeTransfer(receipt);
            else if (receipt.phase === 'completed') execution.completeTransfer(transferId);
            else if (receipt.phase === 'cancelled') execution.cancelTransfer(transferId);
            else execution.failTransfer(transferId, error);
            outcomeReported = true;
            if (receipt.phase !== 'completed') throw new Error(error);
            return true;
        }
        if (request.folderMode === 'combine') throw new Error('Combine folders requires native folder staging; no legacy copy was started');
        if (stagedOnly) return false;
        const options = { transferId, waitForCompletion: true };
        if (sourceConnectionId === destinationConnectionId && sourceConnectionId !== 'local') {
            throw new Error('Same-remote-endpoint link copies require the filesystem copy operation');
        }
        if (sourceConnectionId === 'local') {
            await execution.invoke('sftp_put', { ...options, id: destinationConnectionId, localPath: sourcePath, remotePath: destinationPath });
        } else if (destinationConnectionId === 'local') {
            await execution.invoke('sftp_get', { ...options, id: sourceConnectionId, remotePath: sourcePath, localPath: destinationPath });
        } else {
            await execution.invoke('sftp_copy_to_server', { ...options, sourceConnectionId, sourcePath, destinationConnectionId, destinationPath });
        }
        execution.completeTransfer(transferId);
        return true;
    } catch (error) {
        if (!outcomeReported) {
            if (isTransferCancellation(error)) execution.cancelTransfer(transferId);
            else execution.failTransfer(transferId, transferErrorMessage(error));
        }
        throw error;
    } finally {
        ownedReservation?.release();
    }
}

/** null means the existing top-level link policy, decided before mutation. Errors never select a fallback. */
async function invokeStagedFileTransfer(request: FileTransferRequest, invoke: FileTransferExecution['invoke']): Promise<NativeFileTransferReceipt | null> {
    const result = await invoke('fs_transfer_file', {
        transferId: request.transferId, sourceConnectionId: request.sourceConnectionId, sourcePath: request.sourcePath,
        destinationConnectionId: request.destinationConnectionId, destinationPath: request.destinationPath,
        overwrite: request.overwrite ?? false,
        ...(request.folderMode ? { folderMode: request.folderMode } : {}),
    });
    if (result === null) return null;
    const receipt = nativeFileTransferReceipt(result);
    if (receipt.id !== request.transferId || receipt.destinationConnectionId !== request.destinationConnectionId
        || (receipt.combine?.destinationRoot ?? receipt.destinationPath) !== request.destinationPath || receipt.sourceConnectionId !== request.sourceConnectionId
        || (receipt.combine?.sourceRoot ?? receipt.sourcePath) !== request.sourcePath
        || request.folderMode === 'combine' && !receipt.combine
        || request.folderMode !== 'combine' && receipt.combine) throw new Error('Native transfer receipt does not match the requested operation');
    if (isNativeTransferActive(receipt)) throw new Error('Native file transfer did not return a terminal outcome');
    return receipt;
}

/** Only an explicit unhandled-kind response permits the caller's existing policy. */
export function tryStagedFileTransfer(request: FileTransferRequest, execution: FileTransferExecution,
    reservation?: FileDestinationReservation): Promise<boolean> {
    return runFileTransfer(request, execution, reservation, true);
}

/** Await the native outcome; background submission acknowledgement never authorizes cleanup. */
export async function executeFileTransfer(request: FileTransferRequest, execution: FileTransferExecution,
    reservation?: FileDestinationReservation): Promise<void> {
    await runFileTransfer(request, execution, reservation, false);
}
