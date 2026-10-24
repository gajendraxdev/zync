import { useEffect, useState } from 'react';
import { AlertCircle, Download, Loader2, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../../components/ui/Button';
import { ConfirmModal } from '../../../components/ui/ConfirmModal';
import { useAssessment } from '../application/useAssessment';
import { hardeningSudoRetryLabel, type AssessmentRequest, type SudoRetryLabel } from '../domain/assessment';
import { exportAssessment } from '../infrastructure/assessmentIpc';
import { FindingResults } from './FindingResults';
import { ReportOverview } from './ReportOverview';
import { AssessmentPasswordDialog } from './AssessmentPasswordDialog';
import { HardeningSetup } from './HardeningSetup';


/** Describe the exact read-only approval without suggesting that sudo must resolve an uncertain failure. */
function confirmationMessage(host: string, username: string, elevation: boolean, retry: SudoRetryLabel | null) {
    const paragraphs = [
        `Check ${host} as ${username}? No settings will change.`,
        retry === 'Try with sudo' ? 'We could not confirm why some information was unavailable. Sudo may not help.' : '',
        retry ? 'All hardening checks will run again and replace this report, including checks that already completed.' : '',
        elevation
            ? 'Allow sudo only for fixed, read-only commands that read protected information during this run. Zync asks for a password only if sudo needs one. It stays in memory for this assessment and is never saved, synced or logged. No root shell or sudoers changes. Server policy may still deny access.'
            : 'Checks use your SSH account’s permissions. Sudo will not be requested.',
        'Checks cover selected Linux settings, not a full security or compliance audit or access from the internet. No external service is contacted.',
        `Remote checks have a ${elevation ? '150-second limit, including password entry' : '45-second limit'}. The whole run is limited to five minutes. The host needs GNU coreutils timeout.`,
    ].filter(Boolean);
    return <span className="block space-y-3">{paragraphs.map(paragraph => <span className="block" key={paragraph}>{paragraph}</span>)}</span>;
}

/** Account-free hardening workspace: deliberate execution, short setup and progressive report detail. */
export function SecurityPanel({ connectionId }: { connectionId: string }) {
    const connection = useAppStore(state => state.connections.find(item => item.id === connectionId));
    const showToast = useAppStore(state => state.showToast);
    const connected = connection?.status === 'connected' && connectionId !== 'local';
    const { state, controller } = useAssessment({
        connectionId, name: connection?.name ?? 'Local workspace',
        host: connection?.host ?? '', username: connection?.username ?? '', port: connection?.port ?? 22,
    }, connected, connection?.lastConnected);
    const [elevationConsent, setElevationConsent] = useState(false);
    const [confirmation, setConfirmation] = useState<{ request: AssessmentRequest; retryWithSudo: SudoRetryLabel | null } | null>(null);
    const [exporting, setExporting] = useState(false);
    useEffect(() => { setConfirmation(null); setElevationConsent(false); }, [controller]);
    const busy = state.status === 'running' || state.status === 'stopping';
    const host = connection ? `${connection.username}@${connection.host}` : connectionId === 'local' ? 'Local workspace' : 'SSH host';
    const result = state.status === 'completed' ? state.result : null;
    const canRetryWithSudo = connected && result !== null && Boolean(hardeningSudoRetryLabel(result.report));

    /** Retry is a newly approved full run, never implicit escalation or merged evidence from different runs. */
    const handleRetryWithSudo = (label: SudoRetryLabel) => {
        if (!canRetryWithSudo) return;
        setConfirmation({ request: { kind: 'hardening', elevationConsent: true }, retryWithSudo: label });
    };

    /** Keep export bound to the captured report, even if a new run starts during the save dialog. */
    const handleExport = async () => {
        if (!result || exporting) return;
        setExporting(true);
        try { if (await exportAssessment(result)) showToast('success', 'Assessment report exported.'); }
        catch { showToast('error', 'Could not export the assessment report.'); }
        finally { setExporting(false); }
    };

    return <div className="h-full min-h-0 overflow-auto bg-app-bg text-app-text">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-7 sm:py-7">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                    <ShieldCheck size={21} className="shrink-0 text-app-accent" aria-hidden="true" />
                    <div className="min-w-0"><h1 className="text-base font-semibold tracking-tight">Security</h1><p className="mt-1 break-all text-xs text-app-muted">{host}</p></div>
                </div>
            </header>

            <HardeningSetup connected={connected} local={connectionId === 'local'}
                compact={busy || Boolean(result) || state.status === 'failed'} busy={busy} stopping={state.status === 'stopping'}
                elevationConsent={elevationConsent} onElevationChange={setElevationConsent} onCancel={controller.cancel}
                onRun={() => setConfirmation({ request: { kind: 'hardening', elevationConsent }, retryWithSudo: null })} />

            {busy && <div role="status" aria-live="polite" className="flex items-start gap-3 rounded-lg border border-app-border bg-app-panel p-4">
                <Loader2 size={17} className="shrink-0 animate-spin text-app-accent motion-reduce:animate-none" aria-hidden="true" />
                <div>
                    <p className="text-sm font-medium">{state.status === 'stopping' ? 'Stopping assessment…' : state.status === 'running' && state.authenticationRequired ? 'Waiting for your sudo password…' : 'Checking your host…'}</p>
                    <p className="mt-1 text-xs leading-relaxed text-app-muted">{state.status === 'stopping' ? 'Stopping this run. Incomplete results will not be saved.' : 'Reading Linux settings and running hardening checks. You can keep using your terminals.'}</p>
                </div>
            </div>}
            {state.status === 'failed' && <div role="alert" className="flex gap-3 rounded-lg border border-app-danger/30 bg-app-danger/5 p-4">
                <AlertCircle size={17} className="shrink-0 text-app-danger" aria-hidden="true" /><div><p className="text-sm font-medium">Assessment could not finish</p><p className="mt-1 break-words text-xs text-app-muted">{state.message}</p></div>
            </div>}
            {state.status === 'cancelled' && <p role="status" className="py-3 text-xs text-app-muted">Assessment cancelled. Incomplete results were not saved.</p>}

            {result ? <div className="space-y-4 border-t border-app-border pt-5">
                <div className="flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold">Hardening results</h2>
                    <Button variant="ghost" size="sm" disabled={exporting} onClick={() => void handleExport()}><Download size={14} className="mr-2" aria-hidden="true" />Export JSON</Button>
                </div>
                <ReportOverview result={result} onRetryWithSudo={canRetryWithSudo ? handleRetryWithSudo : undefined} />
                <FindingResults key={result.completedAt} report={result.report} onRetryWithSudo={canRetryWithSudo ? handleRetryWithSudo : undefined} />
                <p className="text-[11px] leading-relaxed text-app-muted">Results stay here until you run again, close the pane or reconnect. Exported reports include host and system information; share carefully.</p>
            </div> : null}
        </div>
        <ConfirmModal isOpen={confirmation !== null} onClose={() => setConfirmation(null)}
            title={confirmation?.retryWithSudo ? `${confirmation.retryWithSudo}?` : 'Run assessment?'}
            message={confirmationMessage(host, connection?.username || 'the connected user', confirmation?.request.elevationConsent ?? false, confirmation?.retryWithSudo ?? null)}
            confirmLabel={confirmation?.retryWithSudo ?? 'Run assessment'}
            confirmDisabled={!connected || (Boolean(confirmation?.retryWithSudo) && !canRetryWithSudo)}
            onConfirm={() => {
                const captured = confirmation;
                setConfirmation(null);
                setElevationConsent(false);
                if (captured && connected && (!captured.retryWithSudo || canRetryWithSudo)) void controller.start(captured.request);
            }} />
        {state.status === 'running' && state.authenticationRequired && <AssessmentPasswordDialog key={state.startedAt} host={host} submit={password => void controller.authenticate(password)} cancel={controller.cancel} />}
    </div>;
}
