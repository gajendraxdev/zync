import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';
import { findingStatusLabel, hardeningAccessLabel, type AssessmentResult, type Finding } from '../domain/assessment';
import { compareAssessments, comparisonIssue, type DifferenceState } from '../domain/review';
import { FindingResults } from './FindingResults';

const LABELS: Record<DifferenceState, string> = { new: 'New', unchanged: 'Unchanged', resolved: 'Resolved', changed: 'Changed', nowAssessed: 'Now assessed', noLongerAssessed: 'No longer assessed', notCompared: 'Not compared' };
const PAGE_SIZE = 25;

/** Keep exact observations available on demand, without interpreting missing checks as passes. */
function ComparisonObservation({ label, finding, missing }: { label: string; finding?: Finding; missing: string }) {
    return <div className="min-w-0 rounded-lg border border-app-border p-3">
        <dt className="text-[11px] font-medium text-app-muted">{label}</dt>
        <dd className="mt-2 space-y-2 text-xs">
            <p className="font-medium">{finding ? findingStatusLabel(finding) : missing}</p>
            {finding?.observed && <p className="break-words text-app-muted">{finding.observed}</p>}
            {finding?.evidence && <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-app-bg p-2 text-[11px] text-app-muted">{finding.evidence}</pre>}
        </dd>
    </div>;
}

/** Compare explicitly imported evidence without treating missing or unassessed checks as fixes. */
export function AssessmentComparison({ current, baseline, source = 'imported', onClear }: { current: AssessmentResult; baseline: AssessmentResult; source?: 'saved' | 'imported'; onClear(): void }) {
    const [filter, setFilter] = useState('changes');
    const [page, setPage] = useState(0);
    const issue = comparisonIssue(current, baseline);
    const rows = useMemo(() => compareAssessments(current, baseline), [current, baseline]);
    const counts = useMemo(() => {
        const totals: Record<DifferenceState, number> = { new: 0, changed: 0, resolved: 0, unchanged: 0, nowAssessed: 0, noLongerAssessed: 0, notCompared: 0 };
        for (const row of rows) totals[row.state]++;
        return totals;
    }, [rows]);
    const visible = useMemo(() => rows.filter(row => {
        if (filter === 'all') return true;
        if (filter === 'changes') return row.state !== 'unchanged' && row.state !== 'notCompared';
        return row.state === filter;
    }), [rows, filter]);
    const last = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1);
    const currentPage = Math.min(page, last);
    return <section aria-label="Assessment comparison" className="rounded-xl border border-app-border bg-app-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div><h3 className="text-xs font-semibold">Compare with {source} report</h3>
                <p className="mt-1 text-[11px] text-app-muted">Earlier: {new Date(baseline.completedAt).toLocaleString()} · {hardeningAccessLabel(baseline.report)}</p>
                <p className="mt-1 text-[11px] text-app-muted">This report: {new Date(current.completedAt).toLocaleString()} · {hardeningAccessLabel(current.report)}</p></div>
            <Button size="icon" variant="ghost" aria-label="Clear comparison" onClick={onClear}><X size={14} /></Button>
        </div>
        <details className="px-4 pb-3 text-[11px] text-app-muted"><summary className="w-fit cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus">About comparison reports</summary><p className="mt-2">Coverage changes do not count as fixes. Imported reports are comparison data; authenticity is not verified.</p></details>
        {issue ? <div className="space-y-3 border-t border-app-border px-4 py-3 text-xs text-app-muted"><p role="status">{issue}</p>
            <details><summary className="w-fit cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus">View {source} checks</summary>
                <div className="mt-3"><FindingResults report={baseline.report} /></div></details></div> : <>
            <div className="flex flex-wrap items-center gap-3 border-t border-app-border px-4 py-3">
                <p className="flex-1 text-xs text-app-muted">{counts.new} new · {counts.changed} changed · {counts.resolved} resolved
                    {counts.nowAssessed > 0 && ` · ${counts.nowAssessed} now assessed`}{counts.noLongerAssessed > 0 && ` · ${counts.noLongerAssessed} no longer assessed`}
                    <span className="mt-1 block text-[11px]">{counts.unchanged} unchanged · {counts.notCompared} not compared</span></p>
                <div className="w-40"><Select label="Comparison results" value={filter} onChange={value => { setFilter(value); setPage(0); }} options={[
                    { value: 'changes', label: 'Changes' }, { value: 'all', label: 'All comparisons' }, ...Object.entries(LABELS).map(([value, label]) => ({ value, label })),
                ]} /></div>
            </div>
            <div className="divide-y divide-app-border border-t border-app-border">{visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(row => <details key={JSON.stringify([row.current, row.finding.moduleId, row.finding.id, row.finding.targetKey ?? row.finding.target, row.finding.ruleVersion])} data-comparison-state={row.state} className="group text-xs">
                <summary className="flex cursor-pointer list-none items-start gap-3 rounded px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-control-focus">
                    <span className="shrink-0 rounded border border-app-border px-2 py-0.5 text-app-muted">{LABELS[row.state]}</span>
                    <span className="min-w-0 flex-1 break-words">{row.finding.title}<span className="mt-1 block text-[11px] text-app-muted">{row.finding.target}</span>
                        <span className="mt-1 block text-[11px] text-app-muted">{row.previous ? findingStatusLabel(row.previous) : 'Not in earlier report'} → {row.current ? findingStatusLabel(row.finding) : 'Not in this report'}</span></span>
                    <ChevronDown size={14} className="shrink-0 text-app-muted group-open:rotate-180" aria-hidden="true" />
                </summary>
                <dl className="grid gap-3 px-4 pb-3 sm:grid-cols-2">
                    <ComparisonObservation label="Earlier report" finding={row.previous} missing="Not in earlier report" />
                    <ComparisonObservation label="This report" finding={row.current ? row.finding : undefined} missing="Not in this report" />
                </dl>
            </details>)}{visible.length === 0 && <div className="space-y-2 px-4 py-5 text-xs text-app-muted">
                <p role="status">{filter === 'changes' ? rows.length === counts.notCompared ? 'These checks could not be compared.' : 'No changes found in comparable checks.' : 'No checks match this comparison filter.'}</p>
                {filter === 'changes' && counts.notCompared > 0 && <Button size="sm" variant="ghost" onClick={() => { setFilter('notCompared'); setPage(0); }}>View {counts.notCompared} not compared</Button>}
            </div>}</div>
            <div className="flex items-center justify-between gap-3 border-t border-app-border px-4 py-2 text-[11px] text-app-muted">
                <span>{visible.length} comparisons · Missing or unavailable checks are not resolved.</span>
                <div className="flex items-center gap-1"><Button variant="ghost" size="icon" aria-label="Previous comparison page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></Button>
                    <span>{currentPage + 1}/{last + 1}</span><Button variant="ghost" size="icon" aria-label="Next comparison page" disabled={currentPage >= last} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button></div>
            </div>
        </>}
    </section>;
}
