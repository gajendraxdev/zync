import { fileTransferFailureMessage, isTransferCancellation } from './executeFileTransfer';

export interface FileTransferBatchResult {
    failed: number;
    cancelled: number;
    firstError?: string;
}

/** Keep one bounded batch summary; per-file details remain in Transfers. */
export function recordFileTransferFailure(result: FileTransferBatchResult, error: unknown): void {
    if (isTransferCancellation(error)) {
        result.cancelled++;
    } else {
        result.failed++;
        result.firstError ??= fileTransferFailureMessage(error) || 'Transfer failed. Check Transfers for details.';
    }
}

export function fileTransferBatchFailure(result: FileTransferBatchResult): string | undefined {
    return result.failed ? `${result.firstError}${result.failed > 1 ? ` (${result.failed} items failed.)` : ''}` : undefined;
}

/** Backpressure for selected-file batches. Keep descriptors, not one active
 * native task/stream per item; native admission remains the final authority. */
export async function runFileTransferBatch<T>(items: readonly T[], transfer: (item: T) => Promise<unknown>): Promise<FileTransferBatchResult> {
    let next = 0;
    const result: FileTransferBatchResult = { failed: 0, cancelled: 0 };
    const consume = async () => {
        while (next < items.length) {
            const item = items[next++];
            try {
                await transfer(item);
            } catch (error) {
                recordFileTransferFailure(result, error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(2, items.length) }, consume));
    return result;
}
