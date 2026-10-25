import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import type { AssessmentResult, Finding } from '../domain/assessment';
import { createRiskException, type RiskException } from '../domain/review';

/** Accepted risks require an explanation and expiration, and annotate only this exact evidenced finding. */
export function RiskExceptionDialog({ result, finding, busy = false, onSave, onClose }: {
    result: AssessmentResult; finding: Finding; busy?: boolean; onSave(value: RiskException): void; onClose(): void;
}) {
    const [reason, setReason] = useState('');
    const [days, setDays] = useState('30');
    const [error, setError] = useState(false);
    return <Modal isOpen onClose={onClose} title="Accept this risk" subtitle={finding.title} width="max-w-md">
        <form className="space-y-4" onSubmit={event => {
            event.preventDefault(); const now = Date.now();
            const annotation = createRiskException(result, finding, reason, now + Number(days) * 86400000, now, crypto.randomUUID());
            if (!annotation) { setError(true); return; } onSave(annotation);
        }}>
            <label className="block text-xs text-app-muted">Reason
                <textarea autoFocus value={reason} maxLength={500} onChange={event => setReason(event.target.value)} rows={3}
                    className="mt-2 w-full resize-y rounded-lg border border-app-border bg-app-bg px-3 py-2 text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus" />
            </label>
            <Select label="Expires after" value={days} onChange={setDays} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
            <p className="text-xs leading-relaxed text-app-muted">Saved on this device until expiry or removal. The check still needs attention; acceptance applies only to this host, policy and exact evidence.</p>
            {error && <p role="alert" className="text-xs text-app-danger">Add a reason and choose a valid expiry. This finding needs a verified host and rule identity.</p>}
            <div className="flex justify-end gap-2"><Button variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" disabled={!reason.trim() || busy} isLoading={busy}>Accept risk</Button></div>
        </form>
    </Modal>;
}
