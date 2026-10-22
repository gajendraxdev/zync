import { useRef, useState } from 'react';
import { vaultIpc, type VaultItem, type VaultItemDetail } from '../../../../vault/ipc';
import { Button } from '../../../ui/Button';
import { SshCertificateField } from './SshCertificateField';
import { useCredentialFileImports } from './hooks/useCredentialFileImports';

interface VaultSshCertificateEditorProps {
  item: VaultItemDetail;
  onUpdated: (item: VaultItem) => Promise<void>;
}

/** Renew or detach a certificate without exposing the stored private key to the renderer. */
export function VaultSshCertificateEditor({ item, onUpdated }: VaultSshCertificateEditorProps) {
  const [certificate, setCertificate] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const fileImports = useCredentialFileImports();
  const attached = item.credential?.fields.some(field => field.name === 'sshCertificate') === true;

  /** Guard revisions and synced secret payloads without exposing private keys to the renderer. */
  const save = async (value: string | null) => {
    if (saving.current || fileImports.hasPendingImports()) return;
    saving.current = true;
    setIsSaving(true);
    setError('');
    try {
      const updated = await vaultIpc.itemSetSshCertificate(item.id, item.revision, item.secretFingerprint, value);
      setCertificate('');
      try {
        await onUpdated(updated);
      } catch {
        setError('Certificate saved, but the view could not refresh. Reopen credential details.');
      }
    } catch (caught) {
      const message = caught && typeof caught === 'object' && 'message' in caught
        ? String(caught.message) : String(caught);
      setError(message);
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-app-border/60 bg-app-surface/20 p-4">
      <p className="text-sm font-medium text-app-text">
        SSH certificate {attached ? '· Attached' : '· Not attached'}
      </p>
      <SshCertificateField id="vault-details-ssh-certificate" value={certificate}
        onImportStart={fileImports.beginImport}
        onChange={setCertificate} disabled={isSaving} />
      {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        {attached && <Button size="sm" variant="ghost" disabled={isSaving || fileImports.isImporting}
          onClick={() => void save(null)}>Remove certificate</Button>}
        <Button size="sm" disabled={isSaving || fileImports.isImporting || !certificate.trim()} isLoading={isSaving}
          onClick={() => void save(certificate.trim())}>
          {attached ? 'Replace certificate' : 'Attach certificate'}
        </Button>
      </div>
    </section>
  );
}
