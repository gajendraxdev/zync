import { CredentialFileButton } from './CredentialFileButton';
import type { BeginCredentialFileImport } from './hooks/useCredentialFileImports';

interface SshCertificateFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onImportStart: BeginCredentialFileImport;
  disabled?: boolean;
}

/** Shared bounded input for an OpenSSH user certificate, not a CA or TLS certificate. */
export function SshCertificateField({ id, value, onChange, onImportStart, disabled }: SshCertificateFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="block text-xs font-medium text-app-muted">
          SSH user certificate (optional)
        </label>
        <CredentialFileButton kind="sshCertificate" value={value} onChange={onChange}
          onImportStart={onImportStart} disabled={disabled} />
      </div>
      <textarea
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={disabled}
        maxLength={65536}
        rows={3}
        spellCheck={false}
        placeholder="Paste the contents of your -cert.pub file"
        className="w-full rounded-xl border border-app-border bg-app-surface/50 px-3.5 py-2 text-xs text-app-text placeholder:text-app-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-app-accent/40 disabled:opacity-40"
      />
    </div>
  );
}
