import { useMemo } from 'react';
import { CircleCheck, CircleHelp, ListChecks } from 'lucide-react';
import { hardeningAccessLabel, hardeningCoverage, hardeningSudoRetryLabel, type AssessmentResult, type SudoRetryLabel } from '../domain/assessment';
import { Button } from '../../../components/ui/Button';

/** Surface incomplete coverage before any interpretation of passed checks. */
export function ReportOverview({ result, onRetryWithSudo }: { result: AssessmentResult; onRetryWithSudo?: (label: SudoRetryLabel) => void }) {
    const { report } = result;
    const coverage = useMemo(() => hardeningCoverage(report.findings), [report.findings]);
    const retryLabel = hardeningSudoRetryLabel(report);
    const metrics = [
        { label: 'Evaluated', value: coverage.evaluated, icon: ListChecks },
        { label: 'Needs elevated access', value: coverage.elevated, icon: CircleHelp },
        { label: 'Evidence unavailable', value: coverage.unavailable, icon: CircleHelp },
    ];
    return <>
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-app-muted">
            <span className="inline-flex items-center gap-1.5 text-app-text">
                <CircleCheck size={14} aria-hidden="true" />Assessment finished{report.truncated ? ' · Report capped' : ''}
            </span>
            <span>{new Date(result.completedAt).toLocaleString()}</span><span>{report.os}</span>
            <span className="rounded-full border border-app-border px-2 py-1 text-app-text">{hardeningAccessLabel(report)}</span>
        </div>
        <div role="group" aria-label="Hardening coverage" className="grid grid-cols-3 divide-x divide-app-border rounded-lg border border-app-border bg-app-panel py-4">
            {metrics.map(({ label, value, icon: Icon }) => <div key={label} className="flex min-w-0 flex-col px-3 sm:px-5">
                <div className="flex flex-1 items-start gap-1.5 text-app-muted">
                    <Icon size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="text-[11px] sm:text-xs">{label}</span>
                </div>
                <p className="mt-2 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
            </div>)}
        </div>
        {report.truncated && <p className="flex items-start gap-2 text-xs text-app-muted">
            <CircleHelp size={14} className="shrink-0" aria-hidden="true" />Coverage is incomplete. Do not interpret these results as a full assessment.
        </p>}
        <p className="text-xs leading-relaxed text-app-muted">
            {coverage.attention} need attention · {coverage.informational} informational · {coverage.passed} passed.
            {' '}{coverage.evaluated} / {report.findings.length} retained checks evaluated.
            {' '}Unavailable checks are neither passed nor failed.
            {report.elevationRequested ? ' Sudo approval does not guarantee access to every protected check.' : ''}
        </p>
        {retryLabel && onRetryWithSudo && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-app-border bg-app-panel px-4 py-3">
            <p className="text-xs text-app-muted">
                {retryLabel === 'Try with sudo' ? 'Elevation may help protected reads; the failure cause is unconfirmed.' : 'Protected evidence was denied.'}
                {' '}Approval reruns all hardening checks and replaces this report.
            </p>
            <Button variant="secondary" size="sm" onClick={() => onRetryWithSudo(retryLabel)}>{retryLabel}</Button>
        </div>}
        <details className="rounded-lg border border-app-border bg-app-panel text-xs">
            <summary className="cursor-pointer px-4 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus">
                Scope &amp; coverage <span className="ml-2 font-normal text-app-muted">{report.version}</span>
            </summary>
            <div className="space-y-3 border-t border-app-border px-4 py-3 text-app-muted">
                <p className="break-all">{result.subject.username}@{result.subject.host}:{result.subject.port} · {report.target}</p>
                <p>{report.collectorUid === undefined || report.collectorUid === null ? 'Connected UID not recorded' : `Connected UID ${report.collectorUid}`} · {
                    report.elevationRequested === undefined ? 'Sudo approval not recorded.' : report.elevationRequested
                        ? 'Sudo authorized for protected checks; individual reads may still fail.' : 'No sudo requested; existing account privileges apply.'
                }</p>
                <ul className="list-disc space-y-2 pl-4">{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
            </div>
        </details>
    </>;
}
