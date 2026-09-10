import { useCallback, useEffect, useState } from 'react';
import type { FileEntry } from './types';

export function useFileSelection(currentPath: string, connectionId: string | undefined) {
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [focusedFile, setFocusedFile] = useState<string | null>(null);

  useEffect(() => {
    setSelectedFiles([]);
    setFocusedFile(null);
  }, [currentPath, connectionId]);

  const handleSelect = useCallback((filename: string, multi: boolean) => {
    if (!filename) {
      setSelectedFiles([]);
      return;
    }
    if (multi) {
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
    selectContextFile,
  };
}
