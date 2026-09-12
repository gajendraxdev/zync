import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useTauriFileDrop } from '../../hooks/useTauriFileDrop';

export function useFileUploads({
  connectionId,
  isConnected,
  onDragVisualClear,
}: {
  connectionId: string | undefined;
  isConnected: boolean;
  onDragVisualClear: () => void;
}) {
  const uploadAction = useAppStore((state) => state.uploadFiles);
  const showToast = useAppStore((state) => state.showToast);

  const performUpload = useCallback(async (filePaths: string[]) => {
    if (!connectionId || !isConnected) return;
    await uploadAction(connectionId, filePaths);
  }, [connectionId, isConnected, uploadAction]);

  const handleUpload = useCallback(async () => {
    if (!connectionId || !isConnected) return;
    try {
      const { filePaths, canceled } = await window.ipcRenderer.invoke('dialog:openFile');
      if (canceled || filePaths.length === 0) return;
      await performUpload(filePaths);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showToast('error', `Upload failed: ${message}`);
    }
  }, [connectionId, isConnected, performUpload, showToast]);

  const handleUploadFolder = useCallback(async () => {
    if (!connectionId || !isConnected) return;
    try {
      const { filePaths, canceled } = await window.ipcRenderer.invoke('dialog:openDirectory');
      if (canceled || filePaths.length === 0) return;
      await performUpload(filePaths);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showToast('error', `Upload failed: ${message}`);
    }
  }, [connectionId, isConnected, performUpload, showToast]);

  const { isDraggingOver: isTauriDraggingOver } = useTauriFileDrop(useCallback((paths: string[]) => {
    onDragVisualClear();
    if (connectionId) void performUpload(paths);
  }, [connectionId, onDragVisualClear, performUpload]));

  return {
    performUpload,
    handleUpload,
    handleUploadFolder,
    isTauriDraggingOver,
  };
}
