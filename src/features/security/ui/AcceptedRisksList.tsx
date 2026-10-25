import { useMemo, useState, type Ref } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import type { SavedRisk } from '../domain/acceptedRisks';
import type { ScopePreset } from '../domain/modules';
import { auditPolicyRevisionLabel, auditPresetLabel } from '../domain/presentation';

const PAGE_SIZE = 5;

/** Host-scoped acceptances are visible independently from report history and removable without a new scan. */
export function AcceptedRisksList({ rows, status, busy, now, headingRef, onRefresh, onRemove, presets = [] }: {
    rows: readonly SavedRisk[]; status: 'idle' | 'loading' | 'ready' | 'failed'; busy: boolean; now: number; headingRef?: Ref<HTMLHeadingElement>;
    onRefresh(): void; onRemove(value: SavedRisk): void;
    presets?: readonly ScopePreset[];
}) {
    const [query, setQuery] = useState(''); const [page, setPage] = useState(0);
    const visible = useMemo(() => {
        const text = query.trim().toLocaleLowerCase();
        return rows.filter(row => !text || `${row.title} ${row.target} ${row.annotation.ruleId} ${row.annotation.reason}`.toLocaleLowerCase().includes(text));
    }, [rows, query]);
    const last = Math.max(0, Math.ceil(visible.length / PAGE_SIZE) - 1); const currentPage = Math.min(page, last);
    return <section aria-label="Saved accepted risks" className="rounded-xl border border-app-border bg-app-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border px-4 py-3">
            <div><h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">Accepted risks</h2>
                <p className="mt-1 text-[11px] text-app-muted">{rows.length} saved on this device</p></div>
            <Button size="icon" variant="ghost" aria-label="Refresh accepted risks" disabled={busy} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" /></Button>
        </div>
        {status === 'idle' || status === 'loading' ? <p role="status" className="px-4 py-6 text-xs text-app-muted">Loading accepted risks…</p>
            : status === 'failed' ? <div className="flex items-center justify-between gap-3 px-4 py-5 text-xs text-app-muted"><p role="alert">Accepted risks could not be loaded.</p><Button size="sm" variant="ghost" onClick={onRefresh} disabled={busy}>Retry</Button></div>
                : <><div className="px-4 py-3"><Input aria-label="Search accepted risks" placeholder="Search accepted risks…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} /></div>
                    <ul className="divide-y divide-app-border">{visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE).map(row => <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                        <details className="min-w-0 flex-1"><summary className="cursor-pointer rounded text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus">
                            <span className="break-words font-medium">{row.title || row.annotation.ruleId}</span><span className="mt-1 block text-[11px] text-app-muted">{row.annotation.expiresAt <= now ? 'Expired' : row.annotation.createdAt > now ? 'Not yet active' : 'Expires'} · {new Date(row.annotation.expiresAt).toLocaleDateString()}</span>
                        </summary><dl className="mt-3 space-y-3 break-words text-xs"><div><dt className="text-app-muted">Reason</dt><dd className="mt-1">{row.annotation.reason}</dd></div>
                            <div><dt className="text-app-muted">Check target</dt><dd className="mt-1 font-mono">{row.target || row.annotation.ruleId}</dd></div>
                            <div><dt className="text-app-muted">Verified host key</dt><dd className="mt-1 font-mono">{row.annotation.transportFingerprint}</dd></div>
                            <div><dt className="text-app-muted">Policy preset</dt><dd className="mt-1">{auditPresetLabel(row.annotation.policyId, presets)} · {auditPolicyRevisionLabel(row.annotation.policyRevision)}</dd></div>
                        </dl></details>
                        <Button size="icon" variant="ghost" disabled={busy} aria-label={`Remove acceptance for ${row.title || row.annotation.ruleId}`} onClick={() => onRemove(row)}><Trash2 size={14} aria-hidden="true" /></Button>
                    </li>)}</ul>
                    {visible.length === 0 && <p className="px-4 py-5 text-xs text-app-muted">{rows.length === 0 ? 'No accepted risks saved. Accept a finding to add it here.' : 'No accepted risks match your search.'}</p>}
                    {visible.length > PAGE_SIZE && <div className="flex items-center justify-between gap-3 border-t border-app-border px-4 py-2 text-[11px] text-app-muted"><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, visible.length)} of {visible.length}</span>
                        <div className="flex gap-1"><Button size="icon" variant="ghost" aria-label="Previous accepted risks" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></Button><Button size="icon" variant="ghost" aria-label="Next accepted risks" disabled={busy || currentPage === last} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button></div></div>}
                </>}
    </section>;
}
