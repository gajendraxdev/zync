import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { cn } from '../../../lib/utils';
import { filterFindings, findingStatusLabel, type AssessmentReport, type SudoRetryLabel } from '../domain/assessment';
import { FindingDetails } from './FindingDetails';

const PAGE_SIZE = 25;
/** Status has a visible text label; color is supplementary, never the sole signal. */
function FindingStatusBadge({ label }: { label: string }) {
    return <span className={cn('inline-flex rounded border px-2 py-0.5 text-[11px] font-medium',
        label === 'Needs attention' ? 'text-app-text border-app-warning/50' : 'text-app-muted border-app-border')}>{label}</span>;
}

/** Search and pagination bound DOM work independently of the native 1,000-finding report cap. */
export function FindingResults({ report, onRetryWithSudo }: { report: AssessmentReport; onRetryWithSudo?: (label: SudoRetryLabel) => void }) {
    const [query, setQuery] = useState('');
    const [status, setStatus] = useState('all');
    const [category, setCategory] = useState('all');
    const [page, setPage] = useState(0);
    const findings = useMemo(() => filterFindings(report.findings, query, status, category), [report.findings, query, status, category]);
    const categories = useMemo(() => [...new Set(report.findings.map(item => item.category).filter((value): value is string => Boolean(value)))].sort(), [report.findings]);
    const findingKeys = useMemo(() => new Map(report.findings.map((finding, index) => [finding, index])), [report.findings]);
    const lastPage = Math.max(0, Math.ceil(findings.length / PAGE_SIZE) - 1);
    const currentPage = Math.min(page, lastPage);
    const visible = findings.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
    return <section aria-label="Assessment findings" className="overflow-hidden rounded-xl border border-app-border bg-app-panel">
        <div className="flex flex-wrap items-end gap-3 border-b border-app-border p-4">
            <div className="min-w-40 flex-1"><Input label="Search findings" placeholder="ID, check or recommendation" value={query} maxLength={256}
                onChange={event => { setQuery(event.target.value); setPage(0); }} rightElement={<Search size={14} aria-hidden="true" />} /></div>
            <div className="w-48"><Select label="Result" value={status} onChange={value => { setStatus(value); setPage(0); }} options={[
                { value: 'all', label: 'All results' }, { value: 'attention', label: 'Needs attention' },
                { value: 'informational', label: 'Informational' }, { value: 'passed', label: 'Passed' },
                { value: 'needsElevatedAccess', label: 'Needs elevated access' }, { value: 'evidenceUnavailable', label: 'Evidence unavailable' },
            ]} /></div>
            {categories.length > 1 && <div className="w-40"><Select label="Category" value={category} onChange={value => { setCategory(value); setPage(0); }} options={[{ value: 'all', label: 'All categories' }, ...categories.map(value => ({ value, label: value }))]} /></div>}
        </div>
        <div className="divide-y divide-app-border">
            {visible.map(finding => <details key={findingKeys.get(finding)} data-assessment-finding className="group/finding">
                <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3.5 text-sm hover:bg-app-surface/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-control-focus [&::-webkit-details-marker]:hidden">
                    <span className="mt-0.5 max-w-[45%] shrink-0"><FindingStatusBadge label={findingStatusLabel(finding)} /></span>
                    <span className="min-w-0 flex-1"><span className="block break-words font-medium">{finding.title || finding.id}</span>
                        <span className="mt-1 block break-words text-xs text-app-muted">{finding.id}</span></span>
                    <ChevronRight size={15} aria-hidden="true" className="mt-1 shrink-0 text-app-muted transition-transform group-open/finding:rotate-90 motion-reduce:transition-none" />
                </summary>
                <FindingDetails finding={finding} onRetryWithSudo={onRetryWithSudo} />
            </details>)}
            {visible.length === 0 && <div className="px-6 py-12 text-center text-sm text-app-muted">
                {report.findings.length === 0 ? 'No checks reported in this scope. This does not guarantee the host is secure; review scope and coverage.' : 'No findings match your filters.'}
            </div>}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-app-border px-4 py-2 text-xs text-app-muted">
            <span aria-live="polite">{findings.length} displayed{report.truncated ? ` of ${report.totalFindings} reported` : ''}</span>
            <div className="flex items-center gap-2"><Button size="icon" variant="ghost" aria-label="Previous findings page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button>
                <span>{currentPage + 1} / {lastPage + 1}</span><Button size="icon" variant="ghost" aria-label="Next findings page" disabled={currentPage >= lastPage} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div>
        </div>
    </section>;
}
