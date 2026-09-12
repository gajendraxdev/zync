import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { FileEntry } from './types';

export function useFileClipboard({
  connectionId,
  currentPath,
  files,
  selectedFiles,
}: {
  connectionId: string | undefined;
  currentPath: string;
  files: FileEntry[];
  selectedFiles: string[];
}) {
  const setClipboard = useAppStore((state) => state.setClipboard);
  const clipboard = useAppStore((state) => state.clipboard);
  const showToast = useAppStore((state) => state.showToast);

  const handleCopy = useCallback((cut = false) => {
    if (!connectionId || selectedFiles.length === 0) return;
    const selectedEntries = files.filter((file) => selectedFiles.includes(file.name));
    setClipboard(selectedEntries, connectionId, currentPath, cut ? 'cut' : 'copy');
    showToast('info', `${cut ? 'Cut' : 'Copied'} ${selectedEntries.length} item(s)`);
  }, [connectionId, currentPath, files, selectedFiles, setClipboard, showToast]);

  return { handleCopy, clipboard };
}
