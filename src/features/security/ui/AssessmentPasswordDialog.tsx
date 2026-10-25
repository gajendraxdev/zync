import { useState } from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Input } from '../../../components/ui/Input';
import { Button } from '../../../components/ui/Button';

/** Mounted only for a live native challenge; no retention option, global state or reusable credential. */
export function AssessmentPasswordDialog({ host, submit, cancel }: { host: string; submit(password: string): void; cancel(): void }) {
    const [password, setPassword] = useState('');
    return <Modal isOpen onClose={cancel} title="Enter sudo password" subtitle={host} width="max-w-sm">
        <form className="space-y-4" onSubmit={event => { event.preventDefault(); if (!password) return; const captured = password; setPassword(''); submit(captured); }}>
            <Input label="Sudo password" type="password" autoComplete="off" spellCheck={false} autoFocus maxLength={4096} value={password} onChange={event => setPassword(event.target.value)} />
            <p className="text-[11px] leading-relaxed text-app-muted">Kept in memory for this run. Never saved, synced or logged.</p>
            <details className="text-[11px] text-app-muted"><summary className="w-fit cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus">Authentication details</summary>
                <p className="mt-2 leading-relaxed">Use your SSH user’s sudo password to read protected information. Server rules still apply. Extra authentication steps (MFA) and TTY-only sudo are unsupported. Closing this dialog cancels the assessment.</p></details>
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={cancel}>Cancel assessment</Button><Button type="submit" disabled={!password}>Continue</Button></div>
        </form>
    </Modal>;
}
