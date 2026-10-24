import { ArrowUpRight, ChevronRight } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../lib/utils';
import { useAppStore } from '../../../store/useAppStore';
import { findingSummary, findingSudoRetryLabel, referenceUrl, type Finding, type SudoRetryLabel } from '../domain/assessment';

/** Show complete evidence on demand; the short presentation never edits retained report or export data. */
function FindingTechnicalDetails({ finding }: { finding: Finding }) {
    const fields = [
        { label: 'Detected in', value: finding.target, mono: true },
        { label: 'Evidence', value: finding.evidence },
        { label: finding.status === 'notAssessed' ? 'Next step' : finding.status === 'informational' ? 'Guidance' : 'Recommendation', value: finding.recommendation },
    ];
    return <details className="group/technical border-t border-app-border pt-2">
        <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded py-1 text-xs text-app-muted hover:text-app-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus [&::-webkit-details-marker]:hidden">
            <ChevronRight size={13} aria-hidden="true" className="shrink-0 transition-transform group-open/technical:rotate-90 motion-reduce:transition-none" />Technical details
        </summary>
        <dl className="mt-3 space-y-3 text-xs">
            {fields.filter(field => Boolean(field.value)).map(field => <div key={field.label}>
                <dt className="text-app-muted">{field.label}</dt>
                <dd className={cn('mt-1 break-words', field.mono && 'font-mono')}>{field.value}</dd>
            </div>)}
        </dl>
    </details>;
}

/** Compact explanation and explicit safe actions; technical evidence stays collapsed until requested. */
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
        <p className="leading-relaxed">{findingSummary(finding)}</p>
        {retryLabel === 'Try with sudo' && <p className="text-[11px] text-app-muted">Elevation may help; the failure cause is unconfirmed.</p>}
        {(retryLabel || reference) && <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {retryLabel && <Button variant="secondary" size="sm" onClick={() => onRetryWithSudo?.(retryLabel)}>{retryLabel}</Button>}
            {reference && <Button variant="ghost" size="sm" aria-label="Open reference" onClick={() => void openReference()} className="h-auto max-w-full px-0 py-1 text-xs text-app-muted">
                Reference<ArrowUpRight size={12} className="ml-1 shrink-0" aria-hidden="true" />
            </Button>}
        </div>}
        <FindingTechnicalDetails finding={finding} />
    </div>;
}
