import { useEffect, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { isMatch } from '../../lib/keyboard';
import type { AppSettings } from '../../store/settingsSlice';
import type { FileEntry } from './types';

function isFileManagerPanelShown(container: HTMLDivElement | null): boolean {
  if (!container) return false;
  return container.offsetParent !== null;
}

export function useFileKeyboard({
  containerRef,
  isConnected,
  isFilesSurfaceActive,
  settings,
  paintedFiles,
  selectedFiles,
  focusedFile,
  setSelectedFiles,
  setFocusedFile,
  viewMode,
  gridColumnCount,
  isSearchOpen,
  searchTerm,
  setIsSearchOpen,
  setSearchTerm,
  isPropertiesOpen,
  setIsPropertiesOpen,
  isNewFolderModalOpen,
  isNewFileModalOpen,
  isRenameModalOpen,
  isCopyModalOpen,
  editingFile,
  activeConnectionId,
  handleNavigate,
  handleCopy,
  handlePaste,
  handleDelete,
  toggleBookmark,
  refreshFiles,
  navigateBack,
  navigateForward,
  setViewMode,
  updateFileManagerSettings,
  setIsEditingPath,
  setRenameOldName,
  setRenameNewName,
  setIsRenameModalOpen,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  isConnected: boolean;
  isFilesSurfaceActive: boolean;
  settings: AppSettings;
  paintedFiles: FileEntry[];
  selectedFiles: string[];
  focusedFile: string | null;
  setSelectedFiles: Dispatch<SetStateAction<string[]>>;
  setFocusedFile: Dispatch<SetStateAction<string | null>>;
  viewMode: 'grid' | 'list';
  gridColumnCount: number;
  isSearchOpen: boolean;
  searchTerm: string;
  setIsSearchOpen: (open: boolean) => void;
  setSearchTerm: (term: string) => void;
  isPropertiesOpen: boolean;
  setIsPropertiesOpen: Dispatch<SetStateAction<boolean>>;
  isNewFolderModalOpen: boolean;
  isNewFileModalOpen: boolean;
  isRenameModalOpen: boolean;
  isCopyModalOpen: boolean;
  editingFile: FileEntry | null;
  activeConnectionId: string | undefined;
  handleNavigate: (name: string) => void;
  handleCopy: (cut?: boolean) => void;
  handlePaste: () => void;
  handleDelete: () => void;
  toggleBookmark: () => void;
  refreshFiles: (connectionId: string) => void;
  navigateBack: (connectionId: string) => void;
  navigateForward: (connectionId: string) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  updateFileManagerSettings: (updates: Partial<AppSettings['fileManager']>) => Promise<void>;
  setIsEditingPath: (editing: boolean) => void;
  setRenameOldName: (name: string) => void;
  setRenameNewName: (name: string) => void;
  setIsRenameModalOpen: (open: boolean) => void;
}) {
  useEffect(() => {
    if (!isConnected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFilesSurfaceActive || !isFileManagerPanelShown(containerRef.current) || isNewFolderModalOpen || isNewFileModalOpen || isRenameModalOpen || editingFile || isCopyModalOpen) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        const isSearchInput = e.target.placeholder?.includes('Search');
        const isNavigationKey = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key);
        if (!(isSearchInput && isNavigationKey)) return;
      }

      const bindings = settings.keybindings || {};

      if (isMatch(e, bindings.fmSelectAll || 'Mod+A')) {
        e.preventDefault();
        setSelectedFiles(paintedFiles.map((f) => f.name));
        return;
      }

      if (isMatch(e, 'Escape')) {
        if (isPropertiesOpen) {
          e.preventDefault();
          setIsPropertiesOpen(false);
          return;
        }
        if (isSearchOpen || searchTerm) {
          setIsSearchOpen(false);
          setSearchTerm('');
        } else {
          setSelectedFiles([]);
          setFocusedFile(null);
        }
        return;
      }

      if (isMatch(e, bindings.fmSearch || 'Mod+F')) {
        e.preventDefault();
        setIsSearchOpen(true);
        return;
      }

      if (isMatch(e, bindings.fmListView || 'Mod+1')) {
        e.preventDefault();
        setViewMode('list');
        return;
      }
      if (isMatch(e, bindings.fmGridView || 'Mod+2')) {
        e.preventDefault();
        setViewMode('grid');
        return;
      }
      if (isMatch(e, bindings.fmHidden || 'Mod+H')) {
        e.preventDefault();
        void updateFileManagerSettings({ showHiddenFiles: !settings.fileManager.showHiddenFiles });
        return;
      }
      if (isMatch(e, bindings.fmBookmark || 'Mod+D')) {
        e.preventDefault();
        toggleBookmark();
        return;
      }
      if (isMatch(e, bindings.fmRefresh || 'F5') || isMatch(e, 'Mod+R')) {
        e.preventDefault();
        if (activeConnectionId) void refreshFiles(activeConnectionId);
        return;
      }
      if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key === '/' || e.key === '~')) {
        e.preventDefault();
        setIsEditingPath(true);
        return;
      }

      if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1 && /^[a-zA-Z0-9_\-]$/.test(e.key)) {
        if (!isSearchOpen) {
          e.preventDefault();
          setIsSearchOpen(true);
          setSearchTerm(e.key);
          return;
        }
      }

      if (isMatch(e, bindings.fmBack || 'Alt+Left')) {
        e.preventDefault();
        if (activeConnectionId) navigateBack(activeConnectionId);
        return;
      }

      if (isMatch(e, bindings.fmForward || 'Alt+Right')) {
        e.preventDefault();
        if (activeConnectionId) navigateForward(activeConnectionId);
        return;
      }

      if (isMatch(e, bindings.fmUp || 'Backspace')) {
        e.preventDefault();
        handleNavigate('..');
        return;
      }

      if (isMatch(e, bindings.fmDelete || 'Delete') && selectedFiles.length > 0) {
        e.preventDefault();
        handleDelete();
        return;
      }

      if (isMatch(e, bindings.fmRename || 'F2') && (focusedFile || selectedFiles.length === 1)) {
        e.preventDefault();
        const fileToRename = focusedFile || selectedFiles[0];
        setRenameOldName(fileToRename);
        setRenameNewName(fileToRename);
        setIsRenameModalOpen(true);
        return;
      }

      if (isMatch(e, bindings.fmEditPath || 'Mod+L')) {
        e.preventDefault();
        setIsEditingPath(true);
        return;
      }

      if (isMatch(e, 'Alt+Enter') && (focusedFile || selectedFiles.length > 0)) {
        e.preventDefault();
        if (!isPropertiesOpen && selectedFiles.length === 0 && focusedFile) {
          setSelectedFiles([focusedFile]);
        }
        setIsPropertiesOpen((prev) => !prev);
        return;
      }

      if (isMatch(e, bindings.fmOpen || 'Enter') && focusedFile) {
        e.preventDefault();
        handleNavigate(focusedFile);
        return;
      }

      if (e.key === ' ' && focusedFile) {
        e.preventDefault();
        setSelectedFiles((prev) => {
          const next = new Set(prev);
          if (next.has(focusedFile)) next.delete(focusedFile);
          else next.add(focusedFile);
          return Array.from(next);
        });
        return;
      }

      if (isMatch(e, bindings.fmCopy || 'Mod+C')) {
        e.preventDefault();
        handleCopy(false);
        return;
      }

      if (isMatch(e, bindings.fmCut || 'Mod+X')) {
        e.preventDefault();
        handleCopy(true);
        return;
      }

      if (isMatch(e, bindings.fmPaste || 'Mod+V')) {
        e.preventDefault();
        handlePaste();
        return;
      }

      if (paintedFiles.length === 0) return;

      const currentIndex = focusedFile ? paintedFiles.findIndex((f) => f.name === focusedFile) : -1;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        let newIndex = currentIndex;
        if (viewMode === 'grid') {
          const gridCols = Math.max(1, gridColumnCount);
          if (e.key === 'ArrowDown') newIndex = Math.min(currentIndex + gridCols, paintedFiles.length - 1);
          else if (e.key === 'ArrowUp') newIndex = Math.max(currentIndex - gridCols, 0);
          else if (e.key === 'ArrowRight') newIndex = Math.min(currentIndex + 1, paintedFiles.length - 1);
          else if (e.key === 'ArrowLeft') newIndex = Math.max(currentIndex - 1, 0);
        } else {
          if (e.key === 'ArrowDown') newIndex = Math.min(currentIndex + 1, paintedFiles.length - 1);
          else if (e.key === 'ArrowUp') newIndex = Math.max(currentIndex - 1, 0);
        }
        if (newIndex === -1) newIndex = 0;
        const newFocused = paintedFiles[newIndex]?.name;
        setFocusedFile(newFocused);
        if (e.shiftKey && newFocused) {
          setSelectedFiles((prev) => {
            const next = new Set(prev);
            next.add(newFocused);
            return Array.from(next);
          });
        } else if (!e.ctrlKey && !e.metaKey) {
          setSelectedFiles([newFocused]);
        }
        return;
      }

      if (e.key === 'Home') {
        e.preventDefault();
        if (paintedFiles.length > 0) setFocusedFile(paintedFiles[0].name);
        return;
      }

      if (e.key === 'End') {
        e.preventDefault();
        if (paintedFiles.length > 0) setFocusedFile(paintedFiles[paintedFiles.length - 1].name);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeConnectionId,
    containerRef,
    editingFile,
    focusedFile,
    gridColumnCount,
    handleCopy,
    handleDelete,
    handleNavigate,
    handlePaste,
    isConnected,
    isCopyModalOpen,
    isFilesSurfaceActive,
    isNewFileModalOpen,
    isNewFolderModalOpen,
    isPropertiesOpen,
    isRenameModalOpen,
    isSearchOpen,
    navigateBack,
    navigateForward,
    paintedFiles,
    refreshFiles,
    searchTerm,
    selectedFiles,
    setFocusedFile,
    setIsEditingPath,
    setIsPropertiesOpen,
    setIsRenameModalOpen,
    setIsSearchOpen,
    setRenameNewName,
    setRenameOldName,
    setSearchTerm,
    setSelectedFiles,
    setViewMode,
    settings,
    toggleBookmark,
    updateFileManagerSettings,
    viewMode,
  ]);
}

export { isFileManagerPanelShown };
