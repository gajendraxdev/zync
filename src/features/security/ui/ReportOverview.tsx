import { useMemo } from 'react';
import { CircleCheck, CircleHelp, ListChecks, ShieldAlert } from 'lucide-react';
import { hardeningAccessLabel, hardeningCoverage, hardeningSudoRetryLabel, type AssessmentResult, type SudoRetryLabel } from '../domain/assessment';
import { Button } from '../../../components/ui/Button';
import { moduleScopeSummary } from '../domain/modules';
import { auditProfileLabel, auditRulesLabel } from '../domain/presentation';

/** Surface incomplete coverage before any interpretation of passed checks. */
export function ReportOverview({ result, historical = false, onRetryWithSudo }: { result: AssessmentResult; historical?: boolean; onRetryWithSudo?: (label: SudoRetryLabel) => void }) {
    const { report } = result;
    const coverage = useMemo(() => hardeningCoverage(report.findings), [report.findings]);
    const retryLabel = hardeningSudoRetryLabel(report);
    const metrics = [
        { label: 'Evaluated', value: coverage.evaluated, icon: ListChecks },
        { label: 'Needs elevated access', value: coverage.elevated, icon: CircleHelp },
        { label: 'Evidence unavailable', value: coverage.unavailable, icon: CircleHelp },
        { label: 'Not applicable', value: coverage.notApplicable, icon: CircleHelp },
    ];
    return <>
        <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-app-muted">
            <span className="inline-flex items-center gap-1.5 text-app-text">
                <CircleCheck size={14} aria-hidden="true" />{historical ? 'Earlier assessment' : 'Assessment finished'}{report.truncated ? ' · Report limit reached' : ''}
            </span>
            <span>{new Date(result.completedAt).toLocaleString()}</span><span>{report.os}</span>
            <span className="rounded-full border border-app-border px-2 py-1 text-app-text">{hardeningAccessLabel(report)}</span>
        </div>
        {report.profile && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-medium">{auditProfileLabel(report.profile)}</span>
            <span className="text-app-muted">· {report.profile.coverage === 'targeted' ? 'Checks for this OS version' : 'Limited coverage for this OS version'}</span>
        </div>}
        {report.policy && <p className="text-xs text-app-muted">Policy preset: {report.policy.label}</p>}
        {report.modules && <p className="text-xs text-app-muted">Assessed scope: {moduleScopeSummary(report.modules)}</p>}
        <div role="group" aria-label="Hardening coverage" className="grid grid-cols-2 gap-y-4 rounded-lg border border-app-border bg-app-panel py-4 sm:grid-cols-4">
            {metrics.map(({ label, value, icon: Icon }) => <div key={label} className="flex min-w-0 flex-col px-3 sm:px-5">
                <div className="flex flex-1 items-start gap-1.5 text-app-muted">
                    <Icon size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="text-[11px] sm:text-xs">{label}</span>
                </div>
                <p className="mt-2 break-words text-lg font-semibold tracking-tight tabular-nums sm:text-2xl">{value}</p>
            </div>)}
        </div>
        {report.truncated && <p className="flex items-start gap-2 text-xs text-app-muted">
            <CircleHelp size={14} className="shrink-0" aria-hidden="true" />The report reached its size limit. Some checks are missing from these results.
        </p>}
        <p className="text-xs leading-relaxed text-app-muted">
            {coverage.attention} need attention · {coverage.informational} informational · {coverage.passed} passed.
            {' '}Checks marked unavailable or not applicable do not count as passed or failed.
            {report.elevationRequested ? ' Allowing sudo does not guarantee that every protected check can be read.' : ''}
        </p>
        {retryLabel && onRetryWithSudo && <div className="flex flex-col gap-3 rounded-lg border border-app-warning/30 bg-app-warning/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
                <ShieldAlert size={16} className="mt-0.5 shrink-0 text-app-warning" aria-hidden="true" />
                <div className="min-w-0 text-xs leading-relaxed">
                    <p className="font-semibold text-app-text">
                        {retryLabel === 'Try with sudo' ? 'Some information couldn’t be read. Sudo may help.' : 'Some checks need additional permissions.'}
                    </p>
                    <p className="mt-1 text-app-muted">Rerun the selected checks with sudo to replace this report.</p>
                </div>
            </div>
            <Button size="sm" className="w-full shrink-0 sm:w-auto" onClick={() => onRetryWithSudo(retryLabel)}>{retryLabel}</Button>
        </div>}
        <details data-assessment-report-scope className="@container rounded-lg border border-app-border bg-app-panel text-xs">
            <summary className="cursor-pointer px-4 py-3 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus">
                About this assessment <span className="ml-2 break-words font-normal text-app-muted">{auditRulesLabel(report.version)}</span>
            </summary>
            <div className="space-y-3 border-t border-app-border px-4 py-3 text-app-muted">
                <p className="break-all">{result.subject.username}@{result.subject.host}:{result.subject.port} · {report.target}</p>
                {report.modules && <div><p className="font-medium text-app-text">Selected check areas</p>
                    <ul className="mt-2 space-y-1">{report.modules.map(module => <li key={module.id}>{module.label} · {module.checkCount} {module.checkCount === 1 ? 'check' : 'checks'}</li>)}</ul>
                </div>}
                <dl className="grid gap-x-6 gap-y-3 @min-[520px]:grid-cols-2">
                    {report.profile && <>
                        <div className="min-w-0"><dt>Detected system</dt><dd className="mt-1 break-words text-app-text">{report.profile.platformId} {report.profile.platformVersion}</dd></div>
                        <div className="min-w-0"><dt>Check profile</dt><dd className="mt-1 break-words text-app-text">{auditProfileLabel(report.profile)}</dd></div>
                    </>}
                    <div className="min-w-0 @min-[520px]:col-span-2"><dt>Audit rules</dt><dd className="mt-1 break-words text-app-text">{auditRulesLabel(report.version, true)}</dd></div>
                    {report.profile && <div className="min-w-0 @min-[520px]:col-span-2"><dt>What this covers</dt><dd className="mt-1 break-words leading-relaxed">{report.profile.coverageNote}</dd></div>}
                </dl>
                <p>{report.collectorUid === undefined || report.collectorUid === null ? 'SSH user ID not recorded' : `SSH user ID (UID): ${report.collectorUid}`} · {
                    report.elevationRequested === undefined ? 'Sudo approval not recorded.' : report.elevationRequested
                        ? 'Sudo was allowed for protected checks. Some information may still be unreadable.' : 'Sudo was not requested. Checks used your SSH account’s permissions.'
                }</p>
                <ul className="list-disc space-y-2 pl-4">{report.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
            </div>
        </details>
    </>;
}
