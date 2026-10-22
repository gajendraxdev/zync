import { useCallback, useRef, useState } from 'react';

export type BeginCredentialFileImport = () => () => void;

/** Track overlapping imports synchronously so neither UI nor direct submits save a partial draft. */
export function useCredentialFileImports() {
  const pending = useRef(new Set<symbol>());
  const [isImporting, setIsImporting] = useState(false);

  /** Return an idempotent release for completion, invalidation or importer unmount. */
  const beginImport = useCallback(() => {
    const token = Symbol('credential-file-import');
    pending.current.add(token);
    setIsImporting(true);
    return () => {
      if (pending.current.delete(token)) setIsImporting(pending.current.size > 0);
    };
  }, []);

  const hasPendingImports = useCallback(() => pending.current.size > 0, []);
  return { isImporting, beginImport, hasPendingImports };
}
