import { useEffect, useId, useRef } from 'react';
import { Check } from 'lucide-react';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { CONTROL_BASE_CLASSES } from '../ui/controlStyles';
import { modeEditAvailability, ordinaryMode, parseOrdinaryMode, unixModeString } from '../../features/files/domain/filePermissions';
import type { FilePermissionEditor } from '../../features/files/application/useFilePermissionEditor';

/** Existing Properties presentation only; drafts, native I/O and mutation ownership
 * stay in the single application hook shared by inline and modal inspectors.
 */
export function FilePermissionsSection({ editor, ownerLabel, groupLabel }: {
    editor: FilePermissionEditor; ownerLabel?: string; groupLabel?: string;
}) {
    const id = useId();
    const state = editor.state;
    const sectionRef = useRef<HTMLElement>(null);
    const firstCheckbox = useRef<HTMLInputElement>(null);
    const editButton = useRef<HTMLButtonElement>(null);
    const refreshButton = useRef<HTMLButtonElement>(null);
    const passwordInput = useRef<HTMLInputElement>(null);
    const prior = useRef({ key: '', editing: false });
    const targetKey = JSON.stringify([state?.target.connectionId, state?.target.path]);
    useEffect(() => {
        const previous = prior.current;
        prior.current = { key: targetKey, editing: Boolean(state?.editing) };
        if (!editor.active) return;
        if (state?.editing && !previous.editing) firstCheckbox.current?.focus();
        else if (!state?.editing && previous.editing && previous.key === targetKey
            && (document.activeElement === document.body || sectionRef.current?.contains(document.activeElement))) {
            (editButton.current && !editButton.current.disabled ? editButton.current : refreshButton.current)?.focus();
        }
    }, [state?.editing, targetKey, editor.active]);
    const metadata = state?.metadata;
    const administrator = Boolean(state?.administrator && state.administrator !== 'password');
    const canReviewAdministrator = state?.target.connectionId !== 'local' && metadata?.binding.model === 'posix'
        && (metadata.snapshot.kind === 'File' || metadata.snapshot.kind === 'Directory');
    useEffect(() => {
        if (state?.administrator === 'password' && !state.applying) passwordInput.current?.focus();
        return () => { if (passwordInput.current) passwordInput.current.value = ''; };
    }, [state?.administrator, state?.applying]);
    const mode = metadata?.snapshot.mode;
    const availability = metadata ? modeEditAvailability(metadata) : null;
    const parsed = parseOrdinaryMode(state?.draft ?? '');
    const invalid = state?.editing && parsed == null;
    const isDirectory = metadata?.snapshot.kind === 'Directory';
    const unsupported = availability?.state === 'unsupported';
    const changed = mode != null && parsed != null && parsed !== (mode & 0o777);
    const octal = mode == null ? '—' : (mode & 0o7777).toString(8).padStart(3, '0');
    const widening = mode != null && parsed != null && Boolean(parsed & ~mode & 0o777);
    const removingTraversal = isDirectory && mode != null && parsed != null && Boolean(mode & ~parsed & 0o111);

    return <section ref={sectionRef} className="border-t border-app-border/30 py-3" aria-labelledby={`${id}-title`}>
        <div className="mb-2 flex items-center justify-between gap-2">
            <h3 id={`${id}-title`} className="text-xs font-medium text-app-text">Permissions</h3>
            <Button ref={refreshButton} type="button" variant="ghost" size="sm" onClick={() => void editor.refresh(true)}
                disabled={state?.loading || state?.applying}>Refresh</Button>
        </div>
        {state?.loading && <p className="text-xs text-app-muted" role="status">Reading permissions…</p>}
        {metadata && <>
            {administrator && <div className="mb-3 space-y-1 border-l-2 border-app-accent pl-2 text-xs leading-relaxed text-app-muted" role="note">
                <p className="font-medium text-app-text">Administrator review · SSH host filesystem</p>
                <p className="break-all">{metadata.path}</p>
                <p>This can differ from the SFTP view. Review this host path and mode before Apply. One item only; review expires after 90 seconds.</p>
            </div>}
            <dl className="space-y-1 text-xs text-app-text">
                {metadata.binding.model === 'windows' ? <div className="flex justify-between gap-3"><dt className="text-app-muted">Access model</dt><dd>Windows accounts and ACLs</dd></div> : <>
                    <div className="flex justify-between gap-3"><dt className="text-app-muted">Owner</dt><dd className="min-w-0 break-all text-right">{!administrator && ownerLabel && `${ownerLabel} · `}UID {metadata.uid ?? 'not reported'}</dd></div>
                    <div className="flex justify-between gap-3"><dt className="text-app-muted">Group</dt><dd className="min-w-0 break-all text-right">{!administrator && groupLabel && `${groupLabel} · `}GID {metadata.gid ?? 'not reported'}</dd></div>
                </>}
                {metadata.binding.model === 'posix' && <div className="flex justify-between gap-3"><dt className="text-app-muted">{state?.needsRefresh ? 'Last observed mode' : 'Current mode'}</dt>
                    <dd className="font-mono">{unixModeString(octal)} · {octal}</dd></div>}
                {metadata.readOnly != null && <div className="flex justify-between gap-3"><dt className="text-app-muted">Read-only attribute</dt><dd>{metadata.readOnly ? 'Yes' : 'No'}</dd></div>}
                {mode != null && (mode & 0o7000) !== 0 && <div className="flex justify-between gap-3"><dt className="text-app-muted">Special bits</dt>
                    <dd className="font-mono">{(mode & 0o7000).toString(8)} (not editable)</dd></div>}
            </dl>
            <p id={`${id}-access`} className="mt-2 text-xs leading-relaxed text-app-muted">{availability?.reason}</p>
            {!state?.editing && !state?.administrator && <Button ref={editButton} type="button" variant="secondary" size="sm" className="mt-3"
                aria-describedby={`${id}-access`} disabled={unsupported || state?.needsRefresh || state?.applying}
                isLoading={state?.applying} onClick={editor.edit}>{metadata.systemEditor ? 'Windows permissions…' : 'Edit permissions'}</Button>}
            {canReviewAdministrator && !state?.editing && !state?.administrator && <details className="mt-3 text-xs leading-relaxed text-app-muted">
                <summary className="cursor-pointer">Administrator permissions</summary>
                <p className="mt-2">Requires existing Python 3 at /usr/bin/python3, Linux 6.6+ and compatible sudo policy. No helper is installed. This reviews the SSH host path below, not a proven SFTP object mapping.</p>
                <p className="mt-1 break-all font-mono">{metadata.path}</p>
                <p className="mt-1">Only an explicitly reviewed mode change is supported—not privileged file browsing, saving, ownership changes or recursive edits. Server audit policy still applies.</p>
                <Button type="button" variant="secondary" size="sm" className="mt-2" disabled={state?.needsRefresh || state?.applying}
                    onClick={() => void editor.reviewAdministrator()}>Review administrator edit…</Button>
            </details>}
            {state?.administrator === 'password' && <form className="mt-3 space-y-2" onSubmit={event => {
                event.preventDefault();
                if (state.applying || !passwordInput.current) return;
                const password = passwordInput.current.value;
                passwordInput.current.value = '';
                void editor.authenticateAdministrator(password);
            }}>
                <p className="text-xs leading-relaxed text-app-muted">Administrator review uses the SSH host filesystem, not a proven SFTP object mapping.</p>
                <p className="break-all font-mono text-xs text-app-text">{metadata.path}</p>
                <p className="text-xs leading-relaxed text-app-muted">The server’s sudo policy requests a password. It is sent once over this SSH session, not saved in Zync. MFA and terminal-based prompts are unsupported. Authentication only prepares a review; it does not change permissions.</p>
                <Input ref={passwordInput} label="Password requested by sudo" type="password" autoComplete="off" maxLength={4096}
                    spellCheck={false} autoCapitalize="none" disabled={state.applying} required />
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={state.applying} isLoading={state.applying}>Continue to review</Button>
                    <Button type="button" size="sm" variant="secondary" disabled={state.applying} onClick={editor.discard}>Cancel review</Button>
                </div>
            </form>}
            {state?.editing && <div className="mt-3 space-y-3">
                <p id={`${id}-caution`} className="text-xs leading-relaxed text-app-muted">
                    This item only. Mode changes may affect ACL masks and hard-linked names.
                </p>
                <details className="text-xs leading-relaxed text-app-muted"><summary className="cursor-pointer">Permission safety details</summary>
                    <p className="mt-1">ACLs are not inspected. {administrator || metadata.localIdentity
                        ? 'Changes use a captured native object handle. This is not atomic against concurrent metadata changes.'
                        : 'SFTP path checks cannot prevent another client replacing this item during Apply.'}
                        {' '}Existing special bits are requested unchanged, but the filesystem may adjust them. Current mode is read back after acknowledgement.</p>
                </details>
                {metadata.linkCount != null && metadata.linkCount > 1 && <p className="text-xs text-app-accent">This item has {metadata.linkCount} hard links. All names share permission changes.</p>}
                <fieldset disabled={state.applying} aria-describedby={`${id}-caution`}>
                    <legend className="sr-only">Ordinary permissions</legend>
                    <table className="w-full text-xs text-app-text">
                        <thead><tr className="text-app-muted"><th scope="col" className="py-1 text-left font-normal">Who</th>
                            {['Read', 'Write', isDirectory ? 'Traverse' : 'Execute'].map(label => <th key={label} scope="col" className="py-1 text-center font-normal">{label}</th>)}
                        </tr></thead>
                        <tbody>{['Owner', 'Group', 'Others'].map((who, index) => <tr key={who}>
                            <th scope="row" className="py-2 text-left font-normal">{who}</th>
                            {[4, 2, 1].map((bit, column) => {
                                const mask = bit << (6 - index * 3);
                                const checked = parsed != null && Boolean(parsed & mask);
                                return <td key={bit} className="text-center"><label className="relative inline-flex h-6 w-6 items-center justify-center">
                                    <input ref={index === 0 && column === 0 ? firstCheckbox : undefined} type="checkbox"
                                    aria-label={`${who} ${['read', 'write', isDirectory ? 'traverse' : 'execute'][column]}`}
                                    className={`h-4 w-4 cursor-pointer appearance-none border border-app-muted bg-app-surface checked:border-app-accent checked:bg-app-accent forced-colors:appearance-auto ${CONTROL_BASE_CLASSES}`}
                                    checked={checked} disabled={parsed == null || state.applying}
                                    onChange={event => editor.setDraft(ordinaryMode(event.target.checked ? parsed! | mask : parsed! & ~mask))} />
                                    {checked && <Check aria-hidden="true" size={12} strokeWidth={2.5} className="pointer-events-none absolute text-control-on-primary forced-colors:hidden" />}
                                </label></td>;
                            })}
                        </tr>)}</tbody>
                    </table>
                </fieldset>
                <Input label="Octal (three digits)" value={state.draft} maxLength={3} spellCheck={false} autoComplete="off"
                    disabled={state.applying} onChange={event => editor.setDraft(event.target.value)}
                    error={invalid ? 'Enter exactly three digits from 0 to 7.' : undefined} className="font-mono" />
                <p className="text-xs text-app-muted">Ordinary mode: {ordinaryMode(mode!)} → {parsed == null ? '—' : ordinaryMode(parsed)}</p>
                {widening && <p className="text-xs text-app-accent">This grants additional access. Review who should have it.</p>}
                {removingTraversal && <p className="text-xs text-app-accent">Removing traverse permission can prevent access to this folder’s contents.</p>}
                <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" isLoading={state.applying} disabled={!changed || invalid || state.needsRefresh}
                        onClick={() => void editor.apply()}>Apply</Button>
                    <Button type="button" size="sm" variant="secondary" disabled={state.applying} onClick={editor.discard}>Discard draft</Button>
                </div>
                {state.applying && <p className="text-xs text-app-muted">Applying once to this item. Closing Properties does not stop the request.</p>}
            </div>}
        </>}
        <div aria-live="polite" aria-atomic="true" className="mt-2 text-xs leading-relaxed text-app-muted">
            {state?.message && <p>{state.message}</p>}
            {state?.error && <p className="text-control-danger">{state.error}</p>}
            {state?.needsRefresh && <p>Refresh permissions before starting another edit.</p>}
        </div>
    </section>;
}
