import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FileEntry } from './types';

export function useFileSelection(currentPath: string, connectionId: string | undefined, files: readonly FileEntry[]) {
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [focusedFile, setFocusedFile] = useState<string | null>(null);

  useEffect(() => {
    setSelectedFiles([]);
    setFocusedFile(null);
  }, [currentPath, connectionId]);

  // Prune only entries removed from the actual listing, never ones hidden by a
  // quick filter or view preference. Selection must not describe vanished files.
  const knownNames = useMemo(() => new Set(files.map(file => file.name)), [files]);
  useEffect(() => {
    setSelectedFiles(previous => previous.every(name => knownNames.has(name)) ? previous : previous.filter(name => knownNames.has(name)));
    setFocusedFile(previous => previous && !knownNames.has(previous) ? null : previous);
  }, [knownNames]);

  const handleSelect = useCallback((filename: string, multi: boolean) => {
    if (!filename) {
      setSelectedFiles([]);
      return;
    }
    if (multi) {
      setFocusedFile(filename);
      setSelectedFiles((prev) => (
        prev.includes(filename) ? prev.filter((name) => name !== filename) : [...prev, filename]
      ));
      return;
    }
    setSelectedFiles([filename]);
    setFocusedFile(filename);
  }, []);

  const handleSelectAll = useCallback((names: string[]) => {
    setSelectedFiles(names);
  }, []);

  const handleSelectMany = useCallback((names: string[], focusName?: string) => {
    setSelectedFiles(names);
    if (names.length === 0) {
      setFocusedFile(null);
      return;
    }
    if (focusName) {
      setFocusedFile(focusName);
      return;
    }
    setFocusedFile(names[names.length - 1]);
  }, []);

  const selectContextFile = useCallback((file?: FileEntry) => {
    if (!file) return;
    setSelectedFiles((prev) => (prev.includes(file.name) ? prev : [file.name]));
  }, []);

  return {
    selectedFiles,
    setSelectedFiles,
    focusedFile,
    setFocusedFile,
    handleSelect,
    handleSelectAll,
    handleSelectMany,
    selectContextFile,
  };
}
