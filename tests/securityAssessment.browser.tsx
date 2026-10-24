import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { SecurityPanel } from '../src/features/security/ui/SecurityPanel';
import { useAppStore } from '../src/store/useAppStore';
import type { AssessmentReport, AssessmentRequest } from '../src/features/security/domain/assessment';
import '../src/index.css';
import './uiOverlays.browser.css';

let pending: { request: AssessmentRequest; resolve: (report: AssessmentReport) => void; reject: (error: Error) => void } | null = null;
let held: ((value: { id: string; identity: { host: string; username: string; port: number } }) => void) | null = null;
let hold = false;
let begins = 0;
let cancellations = 0;
let authenticationRequired = false;
let uncertainOnly = false;
let rootSession = false;

/** Generate public synthetic findings, never read files or contact a host. */
function report(request: AssessmentRequest): AssessmentReport {
    return {
        kind: 'hardening', target: 'Connected Linux host', os: 'ubuntu 24.04', version: 'zync-linux-4 (fixture)',
        findings: Array.from({ length: 53 }, (_, index) => ({
            id: `AUTH-${index}`, title: `Fixture recommendation ${index}`,
            needsElevatedAccess: !request.elevationConsent && !rootSession && !uncertainOnly && index % 3 === 2 && index % 2 === 0,
            sudoRetryEligible: !request.elevationConsent && !rootSession && index % 3 === 2 && (index % 2 === 0 || index === 5),
            category: index % 2 ? 'Network' : 'Accounts',
            status: index % 3 === 0 ? (index % 2 === 0 ? 'passed' : 'informational') : index % 3 === 1 ? 'attention' : 'notAssessed',
            target: '/fixture', evidence: 'Synthetic evidence only',
            recommendation: index % 3 === 2
                ? 'Resolve the collection failure described in Evidence, then rerun the assessment. Do not change security settings based on this unavailable check.'
                : 'Review host guidance before changing settings.',
            reference: 'https://man.openbsd.org/sshd_config',
        })),
        totalFindings: 53, truncated: false, notes: ['Fixture coverage: restricted files may be unavailable. No changes were applied.'],
        collectorUid: rootSession ? 0 : 1000, elevationRequested: request.elevationConsent ?? false,
    };
}

Object.assign(window, { __TAURI_INTERNALS__: { async invoke(command: string, args: Record<string, unknown>) {
    if (command === 'plugin:dialog|save') return 'C:\\fixture\\assessment.json';
    if (command === 'security_assessment_needs_password') return authenticationRequired;
    if (command === 'security_assessment_authenticate') {
        authenticationRequired = false;
        document.body.dataset.authenticated = String(args.password === 'fixture-secret');
        if (args.password !== 'fixture-secret') { pending?.reject(new Error('Sudo authentication was not accepted. The password was not retried.')); pending = null; }
        return;
    }
    throw new Error(`Unexpected Tauri fixture call: ${command}`);
} } });
window.ipcRenderer = { async invoke(channel: string, payload: Record<string, unknown>) {
    if (channel === 'security_assessment_begin') {
        document.body.dataset.begins = String(++begins);
        if ((payload.expected as { host: string }).host !== 'fixture.invalid') throw new Error('The saved host differs from the live SSH connection. Reconnect before starting an assessment.');
        if (hold) return new Promise(resolve => { held = resolve; });
        return { id: `fixture-${begins}`, identity: payload.expected };
    }
    if (channel === 'security_assessment_run') return new Promise<AssessmentReport>((resolve, reject) => { document.body.dataset.request = JSON.stringify(payload.request); pending = { request: payload.request as AssessmentRequest, resolve, reject }; });
    if (channel === 'security_assessment_cancel') { authenticationRequired = false; document.body.dataset.cancellations = String(++cancellations); return; }
    if (channel === 'fs_write_file') { document.body.dataset.export = String(payload.content); return; }
    if (channel === 'shell:open') { document.body.dataset.reference = String(payload); return; }
    throw new Error(`Unexpected assessment fixture command: ${channel}`);
} } as typeof window.ipcRenderer;
useAppStore.setState({ connections: [{ id: 'fixture', name: 'Production lab', host: 'fixture.invalid', username: 'fixture', port: 22, status: 'connected', lastConnected: 1 }],
    showToast: (type, message) => { document.body.dataset.toast = `${type}:${message}`; } });

/** Fixture controls are outside the production panel and never call native APIs. */
function Fixture() {
    const [open, setOpen] = useState(true);
    const [local, setLocal] = useState(false);
    return <TooltipProvider><div className="flex h-screen flex-col bg-app-bg text-app-text">
        <div className="flex flex-wrap gap-3 border-b border-app-border p-2 text-xs" aria-label="Fixture controls">
            <button onClick={() => { if (pending) { const run = pending; pending = null; run.resolve(report(run.request)); } }}>Complete scan fixture</button>
            <button onClick={() => { uncertainOnly = !uncertainOnly; }}>Toggle uncertain-only fixture</button>
            <button onClick={() => { rootSession = !rootSession; }}>Toggle root fixture</button>
            <button onClick={() => { authenticationRequired = true; }}>Request sudo fixture</button>
            <button onClick={() => { pending?.reject(new Error('Host collection unavailable. Try again later.')); pending = null; }}>Fail scan fixture</button>
            <button onClick={() => { hold = true; }}>Hold admission fixture</button>
            <button onClick={() => { hold = false; held?.({ id: 'held-id', identity: { host: 'fixture.invalid', username: 'fixture', port: 22 } }); held = null; }}>Release admission fixture</button>
            <button onClick={() => useAppStore.setState(state => ({ connections: state.connections.map(item => ({ ...item, status: item.status === 'connected' ? 'disconnected' : 'connected', lastConnected: (item.lastConnected ?? 1) + 1 })) }))}>Toggle connection fixture</button>
            <button onClick={() => setOpen(!open)}>Toggle pane fixture</button>
            <button onClick={() => setLocal(!local)}>Toggle local fixture</button>
            <button onClick={() => useAppStore.setState(state => ({ connections: state.connections.map(item => ({ ...item, host: item.host === 'fixture.invalid' ? 'edited.invalid' : 'fixture.invalid' })) }))}>Edit saved host fixture</button>
        </div>
        <div className="min-h-0 flex-1">{open && <SecurityPanel connectionId={local ? 'local' : 'fixture'} />}</div>
    </div></TooltipProvider>;
}
document.body.dataset.overlayGalleryTheme = 'dark';
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
