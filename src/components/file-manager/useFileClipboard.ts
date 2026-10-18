import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../../store/useAppStore';
import type { FileEntry } from './types';
import { fileErrorMessage, filePermissionFailure, type FileAccessAction } from '../../features/files/domain/filePermissions';

/** Shared menu/shortcut owner. Only known source denials block clipboard intent;
 * Cut needs removal rights, not content-read or same-folder creation rights.
 * SSH Copy checks only explicit sources before publishing clipboard intent.
 * Paste still authorizes the actual work, including all nested folder contents.
 */
export function useFileClipboard({
  connectionId,
  currentPath,
  files,
  selectedFiles,
  instanceId,
  isBlocked,
  active = true,
}: {
  connectionId: string | undefined;
  currentPath: string;
  files: FileEntry[];
  selectedFiles: string[];
  instanceId?: string;
  isBlocked?: (action: FileAccessAction, path?: string) => boolean;
  active?: boolean;
}) {
  const setClipboard = useAppStore((state) => state.setClipboard);
  const showToast = useAppStore((state) => state.showToast);
  const clipboard = useAppStore(state => state.clipboard);
  const connection = useAppStore(state => state.connections.find(item => item.id === connectionId));
  const progressScope = useId();
  const progress = useRef<string | null>(null);
  const selectedEntries = useMemo(() => {
    const names = new Set(selectedFiles);
    return files.filter(file => names.has(file.name));
  }, [files, selectedFiles]);
  const current = useRef({ connectionId, connection, currentPath, selectedEntries, active });
  if (current.current.connectionId !== connectionId || current.current.connection !== connection
    || current.current.currentPath !== currentPath || current.current.selectedEntries !== selectedEntries || current.current.active !== active) {
    current.current = { connectionId, connection, currentPath, selectedEntries, active };
  }
  const scope = current.current;
  const generation = useRef(0);
  const mounted = useRef(true);
  const pending = useRef<{ scope: typeof scope; request: number; job: Promise<void> } | null>(null);
  const [checking, setChecking] = useState<typeof scope | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  const clearProgress = useCallback(() => {
    if (progress.current) useAppStore.getState().removeToast(progress.current);
    progress.current = null;
  }, []);
  useEffect(() => clearProgress, [scope, clipboard, clearProgress]);
  const unavailableReason = useCallback((cut: boolean) => {
    if (!selectedEntries.some(file => isBlocked?.(cut ? 'delete' : 'read', file.path))) return undefined;
    return cut
      ? "You don't have permission to move this item from its folder. Cut is unavailable. Check access again if permissions have changed."
      : "You don't have permission to read this item. Copy is unavailable. Check access again if permissions have changed.";
  }, [selectedEntries, isBlocked]);

  const handleCopy = useCallback((cut = false) => {
    if (!active || !connectionId || selectedEntries.length === 0) return;
    if (!cut && pending.current?.scope === scope && pending.current.request === generation.current) return;
    const request = ++generation.current;
    const reason = unavailableReason(cut);
    if (reason) {
      showToast('info', reason, { id: 'files-clipboard-access', source: 'files', duration: 4000, history: false, silent: true });
      return;
    }
    const publish = () => {
      setClipboard(selectedEntries, connectionId, currentPath, cut ? 'cut' : 'copy', instanceId);
      showToast('info', `${selectedEntries.length} item(s) ready to ${cut ? 'move' : 'copy'}. Choose Paste at the destination.`);
    };
    if (cut || connectionId === 'local') { clearProgress(); setChecking(null); publish(); return; }
    const previousClipboard = useAppStore.getState().clipboard;
    const owns = () => mounted.current && current.current === scope && generation.current === request
      && useAppStore.getState().clipboard === previousClipboard;
    const preceding = pending.current;
    const progressId = `files-copy-check:${progressScope}:${request}`;
    setChecking(scope);
    const job = (async () => {
      // Keep one preflight in flight per surface, even across selection churn.
      await preceding?.job;
      if (!owns()) return;
      progress.current = progressId;
      const timer = setTimeout(() => {
        if (owns()) showToast('info', 'Checking read access…', { id: progressId, source: 'files', duration: 0, history: false, silent: true });
      }, 300);
      try {
        // Bound each native request and check serially, not one channel per row.
        for (let index = 0; index < selectedEntries.length; index += 64) {
          await window.ipcRenderer.invoke('fs_copy_access', { connectionId, paths: selectedEntries.slice(index, index + 64).map(file => file.path) });
          if (!owns()) return;
        }
        publish();
      } catch (error) {
        if (!owns()) return;
        const message = fileErrorMessage(error);
        showToast('info', filePermissionFailure(message) === 'denied'
          ? `Copy unavailable: you don't have permission to read one of the selected items. ${message}`
          : `Could not check Copy access. ${message}`, {
          id: 'files-clipboard-access', source: 'files', duration: 5000, history: false, silent: true,
        });
      } finally {
        clearTimeout(timer);
        useAppStore.getState().removeToast(progressId);
        if (progress.current === progressId) progress.current = null;
      }
    })();
    const owner = { scope, request, job };
    pending.current = owner;
    void job.finally(() => {
      if (pending.current === owner) {
        pending.current = null;
        if (mounted.current) setChecking(null);
      }
    });
  }, [active, connectionId, currentPath, instanceId, scope, selectedEntries, setClipboard, showToast, unavailableReason, clearProgress, progressScope]);

  return { handleCopy, copyUnavailable: checking === scope ? 'Checking read access…' : unavailableReason(false), cutUnavailable: unavailableReason(true) };
}
