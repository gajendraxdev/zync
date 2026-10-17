import type { Transfer } from '../../store/transferSlice';
import type { NativeTransferInspection } from '../../features/files/application/nativeFileTransfer';

const UNCHANGED_STAGING_WARNING = 'Destination left unchanged. A separate staging file may remain; inspect it before cleanup.';

/** Present recorded outcomes without turning an unknown replacement into a safety claim. */
export function transferRecoveryCopy(transfer: Pick<Transfer,
    'status' | 'nativeRecovery' | 'destinationUnchanged' | 'recoveryWarning'>) {
    const warning = transfer.nativeRecovery && transfer.destinationUnchanged
        && transfer.recoveryWarning === UNCHANGED_STAGING_WARNING ? undefined : transfer.recoveryWarning;
    const detail = transfer.status === 'completed' ? undefined
        : transfer.destinationUnchanged ? 'Destination left unchanged.'
            : transfer.nativeRecovery ? warning ? undefined : 'Replacement outcome is uncertain. Inspect the files before retrying.'
                : 'Check the destination; incomplete output may remain.';
    return { detail, warning };
}

/** Inspection reports existence and entry type, not content integrity or cleanup success. */
export function recoveryInspectionSummary(inspection: NativeTransferInspection): string {
    if (inspection.backup) return 'Backup remains; review needed.';
    if (inspection.stage && inspection.stage.kind !== 'File') return 'Temporary path contains an unexpected entry; review needed.';
    if (inspection.stage) return inspection.cleanupAvailable
        ? 'Temporary copy remains; verified cleanup is available.'
        : 'Temporary copy retained; recovery review needed.';
    return 'No temporary copy or backup remains.';
}
