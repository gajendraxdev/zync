import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';
import { credentialError, type ModuleDefinition, type RuntimeCredential } from '../domain/modules';

// One character beyond the native maximum lets validation reject oversized input instead of accepting a silently truncated password.
const MAX_SECRET_INPUT_CHARACTERS = 4097;

/** Ephemeral local-service credentials are entered only for a selected native-authored module. */
export function RuntimeCredentialDialog({ module, previous, onSave, onClose }: {
    module: ModuleDefinition; previous?: RuntimeCredential; onSave(value: RuntimeCredential): void; onClose(): void;
}) {
    const auth = module.auth!;
    const [credential, setCredential] = useState<RuntimeCredential>(() => previous ? { ...previous, database: auth.kind === 'postgresql' ? previous.database : '' } : {
        kind: auth.kind, port: auth.defaultPort, username: '', database: auth.defaultDatabase ?? '', secret: '',
    });
    const [submitted, setSubmitted] = useState(false);
    const error = credentialError(credential, auth);
    const database = auth.kind === 'postgresql';
    return <Modal isOpen onClose={onClose} title={`${module.label} access`} subtitle="Local service on this SSH host · this run only" width="max-w-md">
        <form className="space-y-4" onSubmit={event => {
            event.preventDefault(); setSubmitted(true); if (error) return;
            const captured = { ...credential }; setCredential(value => ({ ...value, secret: '' })); onSave(captured);
        }}>
            <div className="grid grid-cols-[minmax(0,1fr)_100px] gap-3">
                <Input label={auth.usernameRequired ? 'Username' : 'Username (optional)'} maxLength={128} autoComplete="off" value={credential.username} autoFocus
                    onChange={event => setCredential(value => ({ ...value, username: event.target.value }))} />
                <Input label="Port" type="number" min={1} max={65535} value={credential.port || ''} onChange={event => setCredential(value => ({ ...value, port: Number(event.target.value) }))} />
            </div>
            {database && <Input label="Database" maxLength={128} value={credential.database} autoComplete="off" onChange={event => setCredential(value => ({ ...value, database: event.target.value }))} />}
            <Input label={auth.secretLabel + (auth.secretRequired ? '' : ' (optional)')} type="password" autoComplete="off" spellCheck={false} maxLength={MAX_SECRET_INPUT_CHARACTERS} value={credential.secret}
                onChange={event => setCredential(value => ({ ...value, secret: event.target.value }))} />
            <p className="text-[11px] leading-relaxed text-app-muted">Used only for the selected read-only checks. The password or token is kept in memory, never saved, synced or logged.</p>
            {submitted && error && <p role="alert" className="text-xs text-app-danger">{error}</p>}
            <div className="flex justify-end gap-2"><Button variant="ghost" type="button" onClick={onClose}>Cancel</Button><Button type="submit">Use for this run</Button></div>
        </form>
    </Modal>;
}
