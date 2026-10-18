import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useTauriFileDrop } from '../../hooks/useTauriFileDrop';
import type { FileAccessAction } from '../../features/files/domain/filePermissions';

export function useFileUploads({
  connectionId,
  isConnected,
  onDragVisualClear,
  instanceId,
  onUploadPaths,
  isBlocked,
}: {
  connectionId: string | undefined;
  isConnected: boolean;
  onDragVisualClear: () => void;
  instanceId?: string;
  onUploadPaths?: (paths: string[]) => Promise<void>;
  isBlocked?: (action: FileAccessAction) => boolean;
}) {
  const uploadAction = useAppStore((state) => state.uploadFiles);
  const showToast = useAppStore((state) => state.showToast);

  const performUpload = useCallback(async (filePaths: string[]) => {
    if (!connectionId || !isConnected) return;
    if (isBlocked?.('receive')) return;
    if (onUploadPaths) await onUploadPaths(filePaths);
    else await uploadAction(connectionId, filePaths, instanceId);
  }, [connectionId, isConnected, instanceId, uploadAction, onUploadPaths, isBlocked]);

  const handleUpload = useCallback(async () => {
    if (!connectionId || !isConnected) return;
    if (isBlocked?.('createFile')) return;
    try {
      const { filePaths, canceled } = await window.ipcRenderer.invoke('dialog:openFile');
      if (canceled || filePaths.length === 0) return;
      await performUpload(filePaths);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showToast('error', `Upload failed: ${message}`);
    }
  }, [connectionId, isConnected, performUpload, showToast, isBlocked]);

  const handleUploadFolder = useCallback(async () => {
    if (!connectionId || !isConnected) return;
    if (isBlocked?.('createFolder')) return;
    try {
      const { filePaths, canceled } = await window.ipcRenderer.invoke('dialog:openDirectory');
      if (canceled || filePaths.length === 0) return;
      await performUpload(filePaths);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      showToast('error', `Upload failed: ${message}`);
    }
  }, [connectionId, isConnected, performUpload, showToast, isBlocked]);

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
