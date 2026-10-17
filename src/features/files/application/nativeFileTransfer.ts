/** Versioned native receipt. Recovery metadata is descriptive, never authority to delete paths. */
export interface NativeFileTransferReceipt {
    version: 1;
    id: string;
    sourceConnectionId: string;
    sourcePath: string;
    destinationConnectionId: string;
    destinationPath: string;
    stagePath: string;
    backupPath: string;
    backupExpected: boolean;
    phase: 'prepared' | 'writing' | 'ready' | 'backingUp' | 'publishing' | 'published' | 'completed' | 'cancelled' | 'failed' | 'needsReview';
    createdAt: number;
    transferred: number;
    total: number;
    destinationUnchanged: boolean;
    /** Absent in older receipts; never infer cleanup merely from cancellation. */
    stageCleaned?: boolean;
    warning: string | null;
    error: string | null;
}

const phases = new Set<NativeFileTransferReceipt['phase']>([
    'prepared', 'writing', 'ready', 'backingUp', 'publishing', 'published', 'completed', 'cancelled', 'failed', 'needsReview',
]);

/** A malformed response is a failure, never permission to fall back and replay a write. */
export function nativeFileTransferReceipt(value: unknown): NativeFileTransferReceipt {
    if (!value || typeof value !== 'object') throw new Error('Invalid native file-transfer receipt');
    const item = value as Record<string, unknown>;
    if (item.version !== 1 || !phases.has(item.phase as NativeFileTransferReceipt['phase'])
        || ['id', 'sourceConnectionId', 'sourcePath', 'destinationConnectionId', 'destinationPath', 'stagePath', 'backupPath']
            .some(key => typeof item[key] !== 'string' || !(item[key] as string).length || (item[key] as string).length > 4096)
        || ['createdAt', 'transferred', 'total'].some(key => typeof item[key] !== 'number' || !Number.isFinite(item[key]) || (item[key] as number) < 0)
        || typeof item.destinationUnchanged !== 'boolean'
        || typeof item.backupExpected !== 'boolean'
        || item.stageCleaned !== undefined && (typeof item.stageCleaned !== 'boolean'
            || item.stageCleaned && (item.phase !== 'cancelled' || item.destinationUnchanged !== true))
        || ['warning', 'error'].some(key => item[key] !== null && typeof item[key] !== 'string')) {
        throw new Error('Invalid native file-transfer receipt');
    }
    return value as NativeFileTransferReceipt;
}

export function isNativeTransferActive(receipt: NativeFileTransferReceipt): boolean {
    return ['prepared', 'writing', 'ready', 'backingUp', 'publishing', 'published'].includes(receipt.phase);
}

/** Match native journal resolution; absent cleanup evidence never means safe. */
export function isNativeTransferResolved(receipt: NativeFileTransferReceipt): boolean {
    return receipt.warning === null && (receipt.phase === 'completed'
        || receipt.phase === 'cancelled' && receipt.stageCleaned === true && receipt.destinationUnchanged);
}

export interface NativeTransferInspection {
    destination: { kind: 'File' | 'Directory' | 'Symlink' | 'Other'; size: number } | null;
    stage: { kind: 'File' | 'Directory' | 'Symlink' | 'Other'; size: number } | null;
    backup: { kind: 'File' | 'Directory' | 'Symlink' | 'Other'; size: number } | null;
    /** Older native hosts omit these fields; absence never enables deletion. */
    cleanupAvailable?: boolean;
    cleanupBlockedReason?: string | null;
}

export function nativeTransferInspection(value: unknown): NativeTransferInspection {
    if (!value || typeof value !== 'object') throw new Error('Invalid recovery inspection');
    const inspection = value as Record<string, unknown>;
    if (inspection.cleanupAvailable !== undefined && (typeof inspection.cleanupAvailable !== 'boolean'
        || inspection.cleanupAvailable && inspection.cleanupBlockedReason !== null
        || !inspection.cleanupAvailable && typeof inspection.cleanupBlockedReason !== 'string')
        || inspection.cleanupBlockedReason !== undefined && inspection.cleanupBlockedReason !== null
            && typeof inspection.cleanupBlockedReason !== 'string') throw new Error('Invalid recovery inspection');
    for (const key of ['destination', 'stage', 'backup']) {
        const entry = inspection[key];
        if (entry === null) continue;
        if (!entry || typeof entry !== 'object') throw new Error('Invalid recovery inspection');
        const item = entry as Record<string, unknown>;
        if (!['File', 'Directory', 'Symlink', 'Other'].includes(String(item.kind)) || typeof item.size !== 'number'
            || !Number.isFinite(item.size) || item.size < 0) throw new Error('Invalid recovery inspection');
    }
    if (inspection.cleanupAvailable && (!inspection.stage || (inspection.stage as { kind: string }).kind !== 'File' || inspection.backup !== null)) {
        throw new Error('Invalid recovery inspection');
    }
    return value as NativeTransferInspection;
}
