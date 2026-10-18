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
    combine?: NativeFolderCombineProgress;
}

export interface NativeFolderCombineProgress {
    sourceRoot: string;
    destinationRoot: string;
    completedItems: number;
    totalItems: number;
    completedBytes: number;
    totalBytes: number;
    currentDone: boolean;
    finished: boolean;
}

function validCombine(value: unknown): value is NativeFolderCombineProgress {
    if (!value || typeof value !== 'object') return false;
    const job = value as Record<string, unknown>;
    return ['sourceRoot', 'destinationRoot'].every(key => typeof job[key] === 'string'
        && (job[key] as string).length > 0 && (job[key] as string).length <= 4096 && !(job[key] as string).includes('\0'))
        && ['completedItems', 'totalItems', 'completedBytes', 'totalBytes'].every(key => typeof job[key] === 'number'
            && Number.isSafeInteger(job[key]) && (job[key] as number) >= 0)
        && Number(job.completedItems) <= Number(job.totalItems) && Number(job.totalItems) <= 100_000
        && Number(job.completedBytes) <= Number(job.totalBytes)
        && typeof job.currentDone === 'boolean' && typeof job.finished === 'boolean';
}

const phases = new Set<NativeFileTransferReceipt['phase']>([
    'prepared', 'writing', 'ready', 'backingUp', 'publishing', 'published', 'completed', 'cancelled', 'failed', 'needsReview',
]);

/** A malformed response is a failure, never permission to fall back and replay a write. */
export function nativeFileTransferReceipt(value: unknown): NativeFileTransferReceipt {
    if (!value || typeof value !== 'object') throw new Error('Invalid native file-transfer receipt');
    const item = value as Record<string, unknown>;
    if (item.version !== 1 || !phases.has(item.phase as NativeFileTransferReceipt['phase'])
        || item.combine !== undefined && !validCombine(item.combine)
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
    return ['prepared', 'writing', 'ready', 'backingUp', 'publishing', 'published'].includes(receipt.phase)
        || receipt.phase === 'completed' && receipt.combine?.finished === false;
}

/** Match native journal resolution; absent cleanup evidence never means safe. */
export function isNativeTransferResolved(receipt: NativeFileTransferReceipt): boolean {
    return receipt.combine?.finished !== false && receipt.warning === null && (receipt.phase === 'completed'
        || receipt.phase === 'cancelled' && (receipt.combine?.currentDone === true
            || receipt.stageCleaned === true && receipt.destinationUnchanged));
}

/** Physical receipt paths remain recovery authority; root paths and aggregate
 * bytes describe the user's job without double-counting its completed cursor. */
export function nativeTransferDisplay(receipt: NativeFileTransferReceipt) {
    const job = receipt.combine;
    return {
        sourcePath: job?.sourceRoot ?? receipt.sourcePath,
        destinationPath: job?.destinationRoot ?? receipt.destinationPath,
        transferred: job ? job.completedBytes + (job.currentDone ? 0 : receipt.transferred) : receipt.transferred,
        total: job?.totalBytes ?? receipt.total,
    };
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
    if (inspection.cleanupAvailable && (!inspection.stage || !['File', 'Directory'].includes((inspection.stage as { kind: string }).kind) || inspection.backup !== null)) {
        throw new Error('Invalid recovery inspection');
    }
    return value as NativeTransferInspection;
}
