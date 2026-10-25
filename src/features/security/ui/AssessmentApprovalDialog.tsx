import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import type { SudoRetryLabel } from '../domain/assessment';
import type { ModuleDefinition, RuntimeCredentialKind } from '../domain/modules';

/** Approval keeps exact scope and elevated access visible; supporting limitations are progressively disclosed. */
export function AssessmentApprovalDialog({ host, preset, modules, elevation, retry, configuredKinds, disabled, onConfigure, onClose, onConfirm }: {
    host: string; preset?: string; modules: readonly ModuleDefinition[]; elevation: boolean; retry: SudoRetryLabel | null;
    configuredKinds: ReadonlySet<RuntimeCredentialKind>; disabled: boolean;
    onConfigure(module: ModuleDefinition): void; onClose(): void; onConfirm(): void;
}) {
    const authModules = modules.filter(module => module.auth);
    const missing = authModules.some(module => !configuredKinds.has(module.auth!.kind));
    return <Modal isOpen onClose={onClose} title={retry ? `${retry}?` : 'Run assessment?'} subtitle={host} width="max-w-md">
        <div className="space-y-4">
            <p className="text-sm font-medium">No settings will change.</p>
            <dl className="divide-y divide-app-border rounded-lg border border-app-border px-3 text-xs">
                {preset && <div className="flex gap-4 py-2.5"><dt className="w-16 shrink-0 text-app-muted">Preset</dt><dd>{preset}</dd></div>}
                <div className="flex gap-4 py-2.5"><dt className="w-16 shrink-0 text-app-muted">Areas</dt><dd className="min-w-0 break-words">{modules.length ? modules.map(module => module.label).join(', ') : 'Host baseline'}</dd></div>
                <div className="flex gap-4 py-2.5"><dt className="w-16 shrink-0 text-app-muted">Access</dt><dd>{elevation ? 'Sudo allowed for fixed protected reads' : 'Existing SSH account permissions; no sudo'}</dd></div>
            </dl>
            {authModules.length > 0 && <div className="flex flex-wrap gap-2" aria-label="Application access required">
                {authModules.map(module => <Button key={module.id} variant="secondary" size="sm" onClick={() => onConfigure(module)}>
                    {module.label}: {configuredKinds.has(module.auth!.kind) ? 'Configured' : 'Add access'}</Button>)}
            </div>}
            {(elevation || authModules.length > 0) && <p className="text-xs leading-relaxed text-app-muted">Passwords and tokens stay in memory for this run. They are never saved, synced or logged.</p>}
            {retry && <p className="text-xs leading-relaxed text-app-muted">Repeats this report’s selected checks and replaces its results.{retry === 'Try with sudo' ? ' The cause of the earlier failure is unconfirmed; sudo may not help.' : ''}</p>}
            <details data-assessment-approval-details className="rounded-lg border border-app-border text-xs">
                <summary className="cursor-pointer px-3 py-2.5 font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus">Run details</summary>
                <div className="space-y-2 border-t border-app-border px-3 py-3 leading-relaxed text-app-muted">
                    <p>Only selected Linux and application settings are checked. Availability and access may limit coverage. This is not a full security/compliance audit or an internet-reachability test.</p>
                    <p>No scanner is installed and no report is uploaded. Application access is limited to the selected local service endpoints; no external assessment service is contacted.</p>
                    <p>{elevation ? 'Sudo is allowed only for fixed, read-only protected commands. Zync asks for a password only if sudo needs one. No root shell or sudoers changes. Existing server policy, authentication cache and logging still apply. MFA/multiple prompts and TTY-only sudo are unsupported.' : 'Sudo will not be requested. Checks use the connected SSH user’s existing privileges, including root access when already connected as root.'}</p>
                    <p>Remote checks have a {elevation ? '240-second limit, including password entry' : '150-second limit'}. The whole run is limited to five minutes. GNU coreutils timeout is required. Closing a requested sudo-password dialog cancels the assessment.</p>
                </div>
            </details>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button disabled={disabled || missing} onClick={onConfirm}>{retry ?? 'Run assessment'}</Button></div>
        </div>
    </Modal>;
}
