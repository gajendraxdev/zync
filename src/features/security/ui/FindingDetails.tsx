import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { findingSummary, findingSudoRetryLabel, referenceUrl, type Finding, type SudoRetryLabel } from '../domain/assessment';

/** Complete normalized evidence and rule provenance are secondary to the observed baseline comparison. */
function FindingTechnicalDetails({ finding, reference, onOpenReference }: { finding: Finding; reference: string | null; onOpenReference: () => void }) {
    const fields = [
        { label: 'Check ID', value: finding.id, mono: true },
        { label: 'Rule version', value: finding.ruleVersion },
        { label: 'Guidance reviewed', value: finding.reviewedAt },
        { label: 'Check target', value: finding.target, mono: true },
        { label: 'Evidence', value: finding.evidence },
        { label: finding.status === 'notAssessed' ? 'Next step' : finding.status === 'informational' || finding.status === 'notApplicable' ? 'Guidance' : 'Recommendation', value: finding.recommendation },
    ];
    return <details className="group/technical border-t border-app-border pt-2">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded py-1 text-xs text-app-muted hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus [&::-webkit-details-marker]:hidden">
            <ChevronRight size={13} aria-hidden="true" className="shrink-0 transition-transform group-open/technical:rotate-90 motion-reduce:transition-none" />Technical details
        </summary>
        <dl className="mt-3 space-y-3 text-xs">
            {fields.filter(field => Boolean(field.value)).map(field => <div key={field.label}>
                <dt className="text-app-muted">{field.label}</dt>
                <dd className={cn('mt-1 break-words leading-relaxed', field.mono && 'font-mono')}>{field.value}</dd>
            </div>)}
        </dl>
        {reference && <Button variant="ghost" size="sm" aria-label="Open reference" onClick={onOpenReference} className="mt-3 h-auto max-w-full px-0 py-1 text-xs text-app-muted">
            Read source guidance<ArrowUpRight size={12} className="ml-1 shrink-0" aria-hidden="true" />
        </Button>}
    </details>;
}

/** Native rule metadata explains the observation without duplicating security rules in the renderer. */
export function FindingDetails({ finding, onRetryWithSudo }: { finding: Finding; onRetryWithSudo?: (label: SudoRetryLabel) => void }) {
    const showToast = useAppStore(state => state.showToast);
    const reference = referenceUrl(finding.reference);
    /** References remain validated external navigation, never executable report text. */
    const openReference = async () => {
        if (!reference) return;
        try { await window.ipcRenderer.invoke('shell:open', reference); }
        catch { showToast('error', 'Could not open the reference.'); }
    };
    const retryLabel = onRetryWithSudo ? findingSudoRetryLabel(finding) : undefined;
    return <div className="space-y-3 border-t border-app-border bg-app-bg/50 px-4 py-3 text-xs">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div><dt className="text-app-muted">What we found</dt><dd className="mt-1 break-words font-medium leading-relaxed">{findingSummary(finding)}</dd></div>
            {finding.expected && <div><dt className="text-app-muted">{finding.status === 'informational' ? 'What to consider' : 'What we look for'}</dt><dd className="mt-1 break-words leading-relaxed">{finding.expected}</dd></div>}
        </dl>
        {finding.applicabilityReason && finding.applicabilityReason !== findingSummary(finding) && <p className="break-words leading-relaxed text-app-muted">{finding.applicabilityReason}</p>}
        {finding.rationale && <p className="break-words leading-relaxed"><span className="text-app-muted">Why it matters: </span>{finding.rationale}</p>}
        {finding.scope && <p className="break-words leading-relaxed text-app-muted"><span className="font-medium">What was checked: </span>{finding.scope}</p>}
        {retryLabel && <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" size="sm" onClick={() => onRetryWithSudo?.(retryLabel)}>{retryLabel}</Button>
            {retryLabel === 'Try with sudo' && <p className="text-[11px] text-app-muted">Sudo may help, but we could not confirm why this check was unavailable.</p>}
        </div>}
        <FindingTechnicalDetails finding={finding} reference={reference} onOpenReference={() => void openReference()} />
    </div>;
}
