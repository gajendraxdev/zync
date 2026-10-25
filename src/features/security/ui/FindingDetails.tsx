import type { ReactNode } from 'react';
import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { findingSummary, findingSudoRetryLabel, referenceUrl, type Finding, type SudoRetryLabel } from '../domain/assessment';
import type { RiskException } from '../domain/review';
import { FindingRecommendation, remediationGuide } from './FindingRecommendation';

const EVIDENCE_LABELS = { runtime: 'Runtime observation', effectiveConfiguration: 'Calculated policy', namedConfiguration: 'Named configuration file', metadata: 'File metadata', serviceConfiguration: 'Named service configuration', workloadConfiguration: 'Workload configuration' };

/** Complete normalized evidence and rule provenance are secondary to the observed baseline comparison. */
function FindingTechnicalDetails({ finding, sourceLink }: { finding: Finding; sourceLink?: ReactNode }) {
    const fields: { label: string; value?: string; mono?: boolean; fullWidth?: boolean }[] = [
        { label: 'Check ID', value: finding.id, mono: true },
        { label: 'Rule version', value: finding.ruleVersion },
        { label: 'Guidance reviewed', value: finding.reviewedAt },
        { label: 'Check target', value: finding.target, mono: true },
        { label: 'Evidence source', value: finding.evidenceKind ? EVIDENCE_LABELS[finding.evidenceKind] : undefined },
        { label: 'Priority', value: finding.status === 'attention' && finding.priority ? { high: 'High priority', medium: 'Medium priority', review: 'Context review' }[finding.priority] : undefined },
        { label: 'Evidence', value: finding.evidence, mono: true, fullWidth: true },
        { label: 'Scope', value: finding.scopeSummary?.trim() && finding.scopeSummary.trim() !== finding.scope?.trim() ? finding.scope : undefined, fullWidth: true },
        { label: finding.status === 'informational' || finding.status === 'notApplicable' ? 'Guidance' : 'Recommendation', value: finding.status === 'attention' || finding.status === 'notAssessed' ? undefined : finding.recommendation, fullWidth: true },
    ];
    return <details className="group/technical border-t border-app-border pt-3">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded py-1 text-sm text-app-muted hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus [&::-webkit-details-marker]:hidden">
            <ChevronRight size={13} aria-hidden="true" className="shrink-0 transition-transform group-open/technical:rotate-90 motion-reduce:transition-none" />Technical details
        </summary>
        <dl className="mt-4 grid gap-x-8 gap-y-5 @min-[520px]:grid-cols-2">
            {fields.filter(field => Boolean(field.value)).map(field => <div key={field.label} className={cn('min-w-0', field.fullWidth && '@min-[520px]:col-span-2')}>
                <dt className="text-xs leading-5 text-app-muted">{field.label}</dt>
                <dd className={cn('mt-1.5 whitespace-pre-wrap break-words leading-6', field.mono && 'font-mono')}>{field.value}</dd>
            </div>)}
        </dl>
        {sourceLink}
    </details>;
}

/** Native rule metadata explains the observation without duplicating security rules in the renderer. */
export function FindingDetails({ finding, onRetryWithSudo, acceptedRisk, onAcceptRisk, onRemoveRisk, historical = false }: {
    finding: Finding; onRetryWithSudo?: (label: SudoRetryLabel) => void; acceptedRisk?: RiskException;
    onAcceptRisk?: (finding: Finding) => void; onRemoveRisk?: (id: string) => void; historical?: boolean;
}) {
    const showToast = useAppStore(state => state.showToast);
    const reference = referenceUrl(finding.reference);
    const guide = remediationGuide(finding);
    const scope = finding.scopeSummary?.trim() || finding.scope;
    /** References remain validated external navigation, never executable report text. */
    const openReference = async () => {
        if (!reference) return;
        try { await window.ipcRenderer.invoke('shell:open', reference); }
        catch { showToast('error', 'Could not open the reference.'); }
    };
    const sourceLink = reference ? <Button variant="ghost" size="sm" aria-label="Open reference" onClick={() => void openReference()} className="mt-4 h-auto max-w-full px-0 py-1 text-sm text-app-muted">
        Read source guidance<ArrowUpRight size={12} className="ml-1 shrink-0" aria-hidden="true" />
    </Button> : undefined;
    const retryLabel = onRetryWithSudo ? findingSudoRetryLabel(finding) : undefined;
    return <div className="@container space-y-5 border-t border-app-border bg-app-bg/50 px-4 py-5 text-sm leading-6">
        {finding.expected && <dl>
            <dt className="text-xs leading-5 text-app-muted">{finding.status === 'informational' ? 'What to consider' : 'What we look for'}</dt>
            <dd className="mt-1.5 break-words leading-6">{finding.expected}</dd>
        </dl>}
        <FindingRecommendation finding={finding} guide={guide} sourceLink={sourceLink} />
        {finding.applicabilityReason && finding.applicabilityReason !== findingSummary(finding) && <p className="break-words leading-6 text-app-muted">{finding.applicabilityReason}</p>}
        {finding.rationale && <p className="break-words leading-6"><span className="text-app-muted">Why it matters: </span>{finding.rationale}</p>}
        {scope && <p className="break-words leading-6 text-app-muted"><span className="font-medium">{finding.status === 'notAssessed' || finding.status === 'notApplicable' ? 'Check scope: ' : 'What was checked: '}</span>{scope}</p>}
        {retryLabel && <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => onRetryWithSudo?.(retryLabel)}>{retryLabel}</Button>
            {retryLabel === 'Try with sudo' && <p className="text-[11px] text-app-muted">Sudo may help, but we could not confirm why this check was unavailable.</p>}
        </div>}
        {acceptedRisk ? <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-app-border p-3">
            <p className="min-w-0 flex-1 break-words leading-6"><span className="font-medium">{historical ? 'Recorded acceptance · expiry ' : 'Accepted until '}{new Date(acceptedRisk.expiresAt).toLocaleDateString()}</span><span className="mt-1.5 block text-app-muted">{acceptedRisk.reason}</span></p>
            {onRemoveRisk && <Button variant="ghost" size="sm" onClick={() => onRemoveRisk(acceptedRisk.id)}>Remove acceptance</Button>}
        </div> : finding.status === 'attention' && finding.targetKey && finding.ruleVersion && finding.evidenceKey && onAcceptRisk && <Button variant="secondary" size="sm" onClick={() => onAcceptRisk(finding)}>Accept risk…</Button>}
        <FindingTechnicalDetails finding={finding} sourceLink={guide ? undefined : sourceLink} />
    </div>;
}
