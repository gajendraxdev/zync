import { useEffect, useRef, useState } from 'react';
import { pickCredentialFile, type CredentialFileKind } from '../../../../vault/credentialFiles';
import { Button } from '../../../ui/Button';
import type { BeginCredentialFileImport } from './hooks/useCredentialFileImports';

interface CredentialFileButtonProps {
  kind: CredentialFileKind;
  value: string;
  onChange: (value: string) => void;
  onImportStart: BeginCredentialFileImport;
  disabled?: boolean;
}

/** Share file import and stale-result protection across key and certificate editors. */
export function CredentialFileButton({ kind, value, onChange, onImportStart, disabled }: CredentialFileButtonProps) {
  const [isReading, setIsReading] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const activeImport = useRef<(() => void) | null>(null);
  useEffect(() => {
    generation.current++;
    setIsReading(false);
    setError('');
    return () => {
      generation.current++;
      activeImport.current?.();
      activeImport.current = null;
    };
  }, [value, disabled, kind]);

  /** Never replace newer edits or an unmounted editor with a delayed file read. */
  const importFile = async () => {
    if (disabled || activeImport.current) return;
    const request = ++generation.current;
    const finish = onImportStart();
    activeImport.current = finish;
    setIsReading(true);
    setError('');
    try {
      const text = await pickCredentialFile(kind);
      if (generation.current === request && text !== null) onChange(text);
    } catch (caught) {
      if (generation.current !== request) return;
      const message = caught && typeof caught === 'object' && 'message' in caught
        ? String(caught.message) : String(caught);
      setError(`Could not import file: ${message}`);
    } finally {
      finish();
      if (generation.current === request) {
        activeImport.current = null;
        setIsReading(false);
      }
    }
  };

  return (
    <div className="max-w-xs text-right">
      <Button type="button" variant="ghost" size="sm" disabled={disabled || isReading}
        isLoading={isReading} onClick={() => void importFile()}
        aria-label={kind === 'privateKey' ? 'Import private key file' : 'Import SSH certificate file'}>
        Import file
      </Button>
      {error && <p role="alert" className="mt-1 text-xs text-control-danger">{error}</p>}
    </div>
  );
}
