import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import type { AssessmentResult } from '../domain/assessment';
import { replacementReports, type ReportRevision, type SavedReportSummary } from '../domain/savedReports';

/** Saving a new report is the default; replacing a named revision requires an explicit choice. */
export function SaveReportDialog({ result, reports, busy, onClose, onSave }: { result: AssessmentResult; reports: readonly SavedReportSummary[]; busy: boolean;
    onClose(): void; onSave(name: string, replace?: ReportRevision): void }) {
    const [mode, setMode] = useState('new');
    const choices = replacementReports(result, reports);
    const [selected, setSelected] = useState(choices[0]?.id ?? '');
    const [name, setName] = useState(`Hardening · ${new Date(result.completedAt).toLocaleString()}`);
    const replacement = choices.find(item => item.id === selected);
    return <Modal isOpen onClose={() => { if (!busy) onClose(); }} title="Save report" subtitle="On this device · includes accepted-risk notes" width="max-w-md">
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (name.trim() && (mode === 'new' || replacement)) onSave(name.trim(), mode === 'replace' ? replacement : undefined); }}>
            <Input autoFocus label="Report name" value={name} maxLength={80} disabled={busy} onChange={event => setName(event.target.value)} />
            <fieldset disabled={busy} className="space-y-2 text-xs"><legend className="mb-2 font-medium">Save option</legend>
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-app-border px-3 py-3"><input type="radio" name="save-mode" value="new" checked={mode === 'new'} onChange={() => setMode('new')} /><span>Save as new</span></label>
                <label className="flex items-center gap-3 rounded-lg border border-app-border px-3 py-3"><input type="radio" name="save-mode" value="replace" checked={mode === 'replace'} disabled={choices.length === 0} onChange={() => setMode('replace')} /><span className={choices.length === 0 ? 'text-app-muted' : ''}>Replace saved report</span></label>
            </fieldset>
            {mode === 'replace' && <><Select label="Report to replace" value={selected} disabled={busy} onChange={id => { setSelected(id); const item = choices.find(item => item.id === id); if (item) setName(item.name); }} options={choices.map(item => ({ value: item.id, label: `${item.name} · ${new Date(item.completedAt).toLocaleDateString()}` }))} />
                <p className="text-xs text-app-muted">The selected saved copy and its notes will be replaced.</p></>}
            <div className="flex justify-end gap-2"><Button variant="ghost" type="button" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" isLoading={busy} disabled={!name.trim() || mode === 'replace' && !replacement}>{mode === 'replace' ? 'Replace report' : 'Save as new'}</Button></div>
        </form>
    </Modal>;
}
