import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';

/** Mounted only for a live native challenge; no retention option, global state or reusable credential. */
export function AssessmentPasswordDialog({ host, submit, cancel }: { host: string; submit(password: string): void; cancel(): void }) {
    const [password, setPassword] = useState('');
    return <Modal isOpen onClose={cancel} title="Authenticate sudo" subtitle={host} width="max-w-sm">
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!password) return; const captured = password; setPassword(''); submit(captured); }}>
            <p className="text-xs leading-relaxed text-app-muted">Your server requested authentication for the protected read-only checks. Enter the connected user’s sudo password. Zync keeps it only in memory for this assessment; it is not saved, synced or logged.</p>
            <Input label="Sudo password" type="password" autoComplete="off" spellCheck={false} autoFocus maxLength={4096} value={password} onChange={event => setPassword(event.target.value)} />
            <p className="text-[11px] leading-relaxed text-app-muted">The server’s sudo policy still applies. MFA and TTY-only workflows are unsupported. Closing this dialog cancels the assessment.</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={cancel}>Cancel assessment</Button><Button type="submit" disabled={!password}>Authenticate</Button></div>
        </form>
    </Modal>;
}
