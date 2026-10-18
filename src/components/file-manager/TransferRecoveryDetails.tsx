import { useState } from 'react';
import { Button } from '../ui/Button';
import type { Transfer } from '../../store/transferSlice';
import { transferErrorMessage } from '../../features/files/application/executeFileTransfer';
import { useAppStore } from '../../store/useAppStore';
import { nativeTransferInspection, type NativeTransferInspection } from '../../features/files/application/nativeFileTransfer';
import { formatBytes } from '../../lib/utils';
import { recoveryInspectionSummary } from './transferRecoveryCopy';

interface TransferRecoveryDetailsProps {
    transfer: Transfer;
    /** The popup owns confirmation so a portalled dialog cannot dismiss its parent. */
    onRequestCleanup: (transfer: Transfer, onConfirm: () => void) => void;
}

/** Read-only inspection and native-verified actions; confirmation uses the popup's shared dialog. */
export function TransferRecoveryDetails({ transfer, onRequestCleanup }: TransferRecoveryDetailsProps) {
    const [pending, setPending] = useState<'inspect' | 'cleanup'>();
    const [inspection, setInspection] = useState<NativeTransferInspection>();
    const [error, setError] = useState<string>();
    const inspect = async () => {
        setPending('inspect');
        setInspection(undefined);
        setError(undefined);
        try {
            const result = nativeTransferInspection(await window.ipcRenderer.invoke('fs_transfer_inspect', { transferId: transfer.id }));
            setInspection(result);
        } catch (error) {
            setError(`Could not inspect files: ${transferErrorMessage(error)}`);
        } finally { setPending(undefined); }
    };
    const cleanup = async () => {
        setPending('cleanup');
        setError(undefined);
        try {
            await window.ipcRenderer.invoke('fs_transfer_cleanup', { transferId: transfer.id });
            const store = useAppStore.getState();
            store.removeTransfer(transfer.id);
            // Listing refresh is separate from the confirmed cleanup outcome.
            void store.refreshConnectionFiles(transfer.destinationConnectionId).catch(console.error);
        } catch (error) {
            setError(`Could not remove temporary copy: ${transferErrorMessage(error)}`);
            setInspection(undefined);
        } finally { setPending(undefined); }
    };
    const describe = (entry: NativeTransferInspection['stage']) => {
        if (!entry) return 'Not present';
        const kind = { File: 'File', Directory: 'Folder', Symlink: 'Symbolic link', Other: 'Other entry' }[entry.kind];
        return entry.kind === 'File' ? `${kind} · ${formatBytes(entry.size)}` : kind;
    };
    return <div className="space-y-1">
        <Button type="button" variant="ghost" size="sm" disabled={Boolean(pending)} onClick={() => void inspect()}
            title="Check file presence and size without changing any files"
            className="h-auto px-1.5 py-1 text-app-accent">
            {pending === 'inspect' ? 'Inspecting…' : 'Inspect recovery files'}
        </Button>
        {error && <p role="status" className="break-words select-text">{error}</p>}
        {inspection && <div role="status" className="space-y-1 break-words select-text">
            <p>{recoveryInspectionSummary(inspection)}</p>
            <p>Destination: {describe(inspection.destination)}</p>
            <p>Temporary copy: {describe(inspection.stage)}</p>
            <p>Backup: {describe(inspection.backup)}</p>
            {inspection.stage && inspection.cleanupBlockedReason && <p>{inspection.cleanupBlockedReason}</p>}
            <p>{!transfer.destinationUnchanged && transfer.status !== 'completed'
                ? 'Replacement outcome is uncertain. Check file contents before deciding what to keep.'
                : 'This check reads presence and size only; it does not verify contents or change files.'}</p>
        </div>}
        {inspection?.cleanupAvailable && <Button type="button" variant="ghost" size="sm" disabled={Boolean(pending)}
            onClick={() => onRequestCleanup(transfer, () => void cleanup())}
            className="h-auto px-1.5 py-1 text-app-accent">
            {pending === 'cleanup' ? 'Removing temporary copy…' : 'Remove temporary copy…'}
        </Button>}
    </div>;
}
