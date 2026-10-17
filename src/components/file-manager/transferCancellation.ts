import { transferErrorMessage } from '../../features/files/application/executeFileTransfer';

/** Legacy native errors that mean a cancel request raced an already terminal operation. */
export function isBenignTransferCancelError(error: unknown): boolean {
    const message = transferErrorMessage(error).toLowerCase();
    return message === 'transfer is no longer active'
        || message === 'not found'
        || message.includes('transfer not found')
        || message.includes('already cancelled')
        || message.includes('already canceled');
}
