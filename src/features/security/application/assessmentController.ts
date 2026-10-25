import type { AssessmentAdmission, AssessmentReport, AssessmentRequest, AssessmentState, AssessmentSubject } from '../domain/assessment';
import { requestError } from '../domain/assessment';
import { sameModuleSelection } from '../domain/modules';
import { credentialError, type RuntimeCredential } from '../domain/modules';

export interface AssessmentPort {
    begin(subject: AssessmentSubject): Promise<AssessmentAdmission>;
    run(id: string, request: AssessmentRequest, credentials?: readonly RuntimeCredential[]): Promise<AssessmentReport>;
    cancel(id: string): Promise<void>;
    needsPassword?(id: string): Promise<boolean>;
    authenticate?(id: string, password: string): Promise<void>;
}
interface Run { cancelled: boolean; id?: string; answered?: boolean; failure?: string }

/** One pane's explicit run ownership. No mount/reconnect/visibility path starts work. */
export class AssessmentController {
    private state: AssessmentState = { status: 'idle' };
    private listeners = new Set<() => void>();
    private owned: Run | null = null;

    /** Capture non-secret host identity separately from the live connection store. */
    constructor(private subject: AssessmentSubject, private port: AssessmentPort) {}

    /** React's external-store snapshot is stable between actual state transitions. */
    snapshot = (): AssessmentState => this.state;
    /** Subscription controls presentation only, never starts or repeats an assessment. */
    subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };
    /** Publish only small normalized states; report arrays never enter the global application store. */
    private publish(state: AssessmentState): void { this.state = state; this.listeners.forEach(listener => listener()); }

    /** Register first so a cancel during admission cannot accidentally launch collectors. */
    async start(request: AssessmentRequest, credentials: readonly RuntimeCredential[] = []): Promise<void> {
        if (this.owned) return;
        const error = requestError(request);
        if (error) { this.publish({ status: 'failed', message: error }); return; }
        if (credentials.length > 4 || new Set(credentials.map(item => item.kind)).size !== credentials.length || credentials.some(item => credentialError(item))) {
            this.publish({ status: 'failed', message: 'Review the application access details before running.' }); return;
        }
        const run: Run = { cancelled: false };
        const captured = { ...request, ...(request.modules ? { modules: [...request.modules] } : {}) };
        const capturedCredentials = credentials.map(item => ({ ...item }));
        const subject = { ...this.subject };
        const startedAt = Date.now();
        let next: AssessmentState | undefined;
        let polling: ReturnType<typeof setInterval> | undefined;
        this.owned = run;
        this.publish({ status: 'running', ...captured, startedAt });
        try {
            const admission = await this.port.begin(subject);
            run.id = admission.id;
            if (run.cancelled) { await this.port.cancel(run.id); return; }
            if (admission.identity.host !== subject.host || admission.identity.username !== subject.username || admission.identity.port !== subject.port) {
                throw new Error('The saved host differs from the live SSH connection. Reconnect before starting an assessment.');
            }
            const boundSubject: AssessmentSubject = { connectionId: subject.connectionId, name: subject.name,
                host: admission.identity.host, username: admission.identity.username, port: admission.identity.port };
            if (captured.elevationConsent && this.port.needsPassword) {
                let pending = false;
                polling = setInterval(async () => {
                    if (pending || run.cancelled || run.answered || this.owned !== run) return;
                    pending = true;
                    try {
                        const required = await this.port.needsPassword!(admission.id);
                        if (required && !run.cancelled && !run.answered && this.owned === run && this.state.status === 'running' && !this.state.authenticationRequired) {
                            this.publish({ ...this.state, authenticationRequired: true });
                        }
                    } catch {
                        if (this.owned === run && !run.cancelled) { run.failure = 'Zync could not read the sudo password request. Restart the app and try again.'; this.cancel(); }
                    } finally { pending = false; }
                }, 250);
            }
            const report = await this.port.run(run.id, captured, capturedCredentials);
            if (!run.cancelled) {
                if (report.kind !== captured.kind) throw new Error('Zync received a different assessment type than requested. Run the assessment again.');
                if (captured.modules && !sameModuleSelection(captured.modules, report.modules)) throw new Error('The returned check areas differ from your approved selection. Run the assessment again.');
                if (captured.presetId && report.policy?.id !== captured.presetId) throw new Error('The returned policy differs from your approved preset. Run the assessment again.');
                next = { status: 'completed', result: { report, subject: boundSubject, startedAt, completedAt: Date.now() } };
            }
        } catch (error) {
            if (!run.cancelled) next = { status: 'failed', message: (error instanceof Error ? error.message : String(error)).slice(0, 1000) };
        } finally {
            capturedCredentials.forEach(item => { item.secret = ''; });
            if (polling) clearInterval(polling);
            if (run.id) { try { await this.port.cancel(run.id); } catch { /* Native and remote deadlines are the fallback. */ } }
            if (this.owned === run) {
                this.owned = null;
                this.publish(run.failure ? { status: 'failed', message: run.failure } : run.cancelled ? { status: 'cancelled' } : next ?? { status: 'idle' });
            }
        }
    }

    /** Submit once to the active native challenge. The password never enters controller state or results. */
    async authenticate(password: string): Promise<void> {
        const run = this.owned;
        if (!run?.id || run.cancelled || run.answered || this.state.status !== 'running' || !this.state.authenticationRequired || !this.port.authenticate) return;
        run.answered = true;
        this.publish({ ...this.state, authenticationRequired: false });
        try { await this.port.authenticate(run.id, password); }
        catch {
            if (this.owned === run && !run.cancelled) { run.failure = 'Zync could not send the sudo password. The assessment stopped without retrying.'; this.cancel(); }
        }
    }

    /** Mark replies stale before sending cancellation; delayed success cannot overwrite it. */
    cancel = (): void => {
        const run = this.owned;
        if (!run || run.cancelled) return;
        run.cancelled = true;
        if (this.state.status === 'running') this.publish({ ...this.state, status: 'stopping' });
        if (run.id) void this.port.cancel(run.id).catch(() => {});
    };
}
