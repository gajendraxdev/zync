import { useState } from 'react';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';

/** Keeping reusable acceptances is the safe default; removal is an explicit separate choice. */
export function DeleteReportDialog({ name, riskCount, busy, onClose, onConfirm }: { name: string; riskCount: number; busy: boolean; onClose(): void; onConfirm(removeRisks: boolean): void }) {
    const [remove, setRemove] = useState(false);
    return <ConfirmModal isOpen title="Delete saved report?" variant="danger" confirmLabel="Delete report" isLoading={busy} onClose={onClose} onConfirm={() => onConfirm(remove)}
        message={<><span>“{name}” will be removed from this device.</span>
            {riskCount > 0 ? <label className="mt-4 flex cursor-pointer items-start gap-2 text-app-text">
                <input type="checkbox" checked={remove} onChange={event => setRemove(event.target.checked)} disabled={busy} className="mt-0.5 accent-app-accent" />
                <span>Also remove matching accepted risks ({riskCount})<span className="mt-1 block text-[11px] font-normal text-app-muted">Other reports keep their recorded notes.</span></span>
            </label> : <span className="mt-3 block text-[11px] text-app-muted">Saved accepted risks are kept separately.</span>}
        </>} />;
}
