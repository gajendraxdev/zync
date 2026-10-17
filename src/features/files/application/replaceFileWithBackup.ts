import type { FileTransferRequest } from './executeFileTransfer';
import { acquireFileDestination, fileDestinationPathsOverlap, type FileDestinationReservation } from './fileDestinationReservations';

/** Lexical preflight only; endpoint aliases and filesystem identities still need native checks. */
export function replacementPreconditionError(request: Omit<FileTransferRequest, 'transferId'>): string | null {
    if (request.sourceConnectionId !== request.destinationConnectionId) return null;
    if (fileDestinationPathsOverlap(request.sourcePath, request.destinationPath)) {
        return 'Source and destination paths overlap; the original was left unchanged';
    }
    return null;
}

export interface ReplacementOperations {
    destinationConnectionId: string;
    rename: (from: string, to: string) => Promise<void>;
    write: (backupPath: string, reservation: FileDestinationReservation) => Promise<void>;
    remove: (path: string) => Promise<void>;
    createBackupId: () => string;
}

export type ReplacementResult =
    | { outcome: 'blocked'; error: unknown }
    | { outcome: 'replaced' }
    | { outcome: 'replaced-backup-retained'; backupPath: string; error: unknown }
    | { outcome: 'unconfirmed'; phase: 'prepare' | 'write'; backupPath: string; error: unknown };

/**
 * Preserve the previous destination until the write's native outcome is confirmed.
 * This is not an atomic transaction. Failure may leave partial content; never
 * restore over that path or retry a mutation whose acknowledgement is uncertain.
 */
export async function replaceFileWithBackup(target: string, operations: ReplacementOperations): Promise<ReplacementResult> {
    let reservation: FileDestinationReservation;
    try {
        reservation = acquireFileDestination(operations.destinationConnectionId, target);
    } catch (error) {
        return { outcome: 'blocked', error };
    }
    let backupReservation: FileDestinationReservation | undefined;
    try {
        const backupPath = `${target}.zync-backup-${operations.createBackupId()}`;
        try {
            backupReservation = acquireFileDestination(operations.destinationConnectionId, backupPath);
        } catch (error) {
            return { outcome: 'blocked', error };
        }
        try {
            await operations.rename(target, backupPath);
        } catch (error) {
            return { outcome: 'unconfirmed', phase: 'prepare', backupPath, error };
        }

        try {
            await operations.write(backupPath, reservation);
        } catch (error) {
            return { outcome: 'unconfirmed', phase: 'write', backupPath, error };
        }

        try {
            await operations.remove(backupPath);
            return { outcome: 'replaced' };
        } catch (error) {
            return { outcome: 'replaced-backup-retained', backupPath, error };
        }
    } finally {
        backupReservation?.release();
        reservation.release();
    }
}
