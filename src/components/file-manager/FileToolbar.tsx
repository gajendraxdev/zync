import {
  Clipboard,
  Copy,
  FilePlus,
  FolderInput,
  FolderPlus,
  Info,
  PanelLeft,
  Plus,
  RefreshCw,
  Search,
  Pin,
  Terminal,
  Upload,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Tooltip } from '../ui/Tooltip';
import { TopbarDropdown } from '../ui/TopbarDropdown';
import { useAppStore } from '../../store/useAppStore';
import { FileHistoryControls, type FileHistoryEntry } from './FileHistoryControls';
import { FilePathBar } from './FilePathBar';
import { FileQueryEditor, type FileSearchTypeFilter } from './FileQueryEditor';
import { FileViewControls } from './FileViewControls';
import { useDismiss } from './useDismiss';
import type { FileSortColumn, FileSortDirection } from './fileGridLayout';

function IconBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} position="bottom">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors',
          'text-app-muted hover:border-app-border/40 hover:bg-app-surface hover:text-app-text',
          'disabled:pointer-events-none disabled:opacity-30',
          active && 'text-app-text bg-app-surface/70',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

interface FileToolbarProps {
  currentPath: string;
  homePath?: string;
  osName?: string;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onUpload: () => void;
  onUploadFolder: () => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  viewMode: 'grid' | 'list';
  onToggleView: (mode: 'grid' | 'list') => void;
  searchTerm: string;
  onSearch: (term: string) => void;
  isSearchOpen: boolean;
  onToggleSearch: (open: boolean) => void;
  isEditingPath: boolean;
  onTogglePathEdit: (editing: boolean) => void;
  isNarrow?: boolean;
  placesCollapsed?: boolean;
  onTogglePlaces?: () => void;
  onBack: () => void;
  onForward: () => void;
  canGoBack: boolean;
  canGoForward: boolean;
  backEntries: FileHistoryEntry[];
  forwardEntries: FileHistoryEntry[];
  onHistoryJump: (index: number) => void;
  showHidden: boolean;
  onToggleHidden: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  sortColumn: FileSortColumn;
  sortDirection: FileSortDirection;
  onSort: (column: FileSortColumn, direction: FileSortDirection) => void;
  onCopyLocation: () => void;
  onBookmark: () => void;
  isBookmarked: boolean;
  onPaste?: () => void;
  canPaste?: boolean;
  onSelectAll?: () => void;
  onProperties?: () => void;
  onOpenTerminal?: () => void;
  typeFilter: FileSearchTypeFilter;
  onTypeFilter: (value: FileSearchTypeFilter) => void;
  connectionId?: string | null;
}

function FileToolbarInner({
  currentPath,
  homePath,
  osName,
  onNavigate,
  onRefresh,
  onUpload,
  onUploadFolder,
  onNewFolder,
  onNewFile,
  viewMode,
  onToggleView,
  searchTerm,
  onSearch,
  isSearchOpen,
  onToggleSearch,
  isEditingPath,
  onTogglePathEdit,
  isNarrow = false,
  placesCollapsed = false,
  onTogglePlaces,
  onBack,
  onForward,
  canGoBack,
  canGoForward,
  backEntries,
  forwardEntries,
  onHistoryJump,
  showHidden,
  onToggleHidden,
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
  sortColumn,
  sortDirection,
  onSort,
  onCopyLocation,
  onBookmark,
  isBookmarked,
  onPaste,
  canPaste,
  onSelectAll,
  onProperties,
  onOpenTerminal,
  typeFilter,
  onTypeFilter,
  connectionId,
}: FileToolbarProps) {
  const [pathInput, setPathInput] = useState(currentPath);
  const compactMode = useAppStore((state) => state.settings.compactMode);
  const checkPathExists = useAppStore((state) => state.checkPathExists);
  const [isInvalid, setIsInvalid] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef(pathInput);
  const connectionIdRef = useRef(connectionId);
  const validationGenRef = useRef(0);

  useEffect(() => {
    pathInputRef.current = pathInput;
  }, [pathInput]);

  useEffect(() => {
    connectionIdRef.current = connectionId;
  }, [connectionId]);

  useEffect(() => {
    if (isEditingPath) setPathInput(currentPath);
  }, [isEditingPath, currentPath]);

  useEffect(() => {
    onSearch('');
    onToggleSearch(false);
  }, [currentPath]);

  const closeMenu = useCallback(() => setIsMenuOpen(false), []);
  useDismiss(isMenuOpen, closeMenu, menuRef);

  const cancelPathEdit = () => {
    validationGenRef.current += 1;
    onTogglePathEdit(false);
    setIsInvalid(false);
  };

  const committedPath = () => (inputRef.current?.value ?? pathInputRef.current).trim();

  const handlePathSubmit = async (source: 'enter' | 'blur' = 'enter') => {
    const submittedPath = committedPath();
    const submittedConnectionId = connectionIdRef.current;
    const gen = ++validationGenRef.current;
    if (!submittedPath) {
      onTogglePathEdit(false);
      setIsInvalid(false);
      return;
    }
    if (submittedPath !== currentPath && submittedConnectionId) {
      const exists = await checkPathExists(submittedConnectionId, submittedPath);
      if (
        gen !== validationGenRef.current
        || submittedPath !== committedPath()
        || submittedConnectionId !== connectionIdRef.current
      ) {
        return;
      }
      if (!exists) {
        setIsInvalid(true);
        if (source !== 'blur') inputRef.current?.focus();
        return;
      }
    } else if (gen !== validationGenRef.current) {
      return;
    }
    onNavigate(submittedPath);
    onTogglePathEdit(false);
    setIsInvalid(false);
  };

  const menuItem = (label: string, icon: ReactNode | undefined, action?: () => void, disabled?: boolean) => (
    <button
      type="button"
      disabled={disabled}
      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm text-app-text hover:bg-app-surface/60 disabled:opacity-40"
      onClick={() => {
        action?.();
        setIsMenuOpen(false);
      }}
    >
      <span className="w-4 shrink-0 text-app-muted">{icon}</span>
      {label}
    </button>
  );

  return (
    <div
      ref={barRef}
      className={cn(
        'relative z-30 flex min-w-0 shrink-0 items-center gap-1 border-b border-app-border/20 bg-app-bg px-1.5',
        compactMode ? 'h-10' : 'h-11',
      )}
    >
      <IconBtn
        label={placesCollapsed ? 'Show places' : 'Hide places'}
        active={!placesCollapsed}
        disabled={!onTogglePlaces}
        onClick={onTogglePlaces}
      >
        <PanelLeft size={14} />
      </IconBtn>

      {!isNarrow && (
        <FileHistoryControls
          canGoBack={canGoBack}
          canGoForward={canGoForward}
          onBack={onBack}
          onForward={onForward}
          backEntries={backEntries}
          forwardEntries={forwardEntries}
          onJump={onHistoryJump}
        />
      )}

      <div className="flex h-8 min-w-0 flex-1 items-center overflow-hidden">
        {isEditingPath ? (
          <div className="flex h-full min-w-0 flex-1 items-center rounded-md bg-app-bg/45 animate-in fade-in duration-150">
            <input
              ref={inputRef}
              autoFocus
              aria-label="Path"
              className={cn(
                'h-full min-w-0 flex-1 bg-transparent px-2.5 text-[12px] outline-none',
                isInvalid ? 'text-app-danger' : 'text-app-text',
              )}
              value={pathInput}
              onChange={(e) => {
                setPathInput(e.target.value);
                if (isInvalid) setIsInvalid(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handlePathSubmit('enter');
                if (e.key === 'Escape') {
                  cancelPathEdit();
                }
              }}
              onBlur={(e) => {
                const next = e.relatedTarget as Node | null;
                if (next && barRef.current?.contains(next)) {
                  cancelPathEdit();
                  return;
                }
                void handlePathSubmit('blur');
              }}
            />
            <button
              type="button"
              aria-label="Cancel"
              className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-app-muted hover:text-app-text"
              onClick={() => {
                cancelPathEdit();
              }}
            >
              <X size={13} />
            </button>
          </div>
        ) : isSearchOpen ? (
          <FileQueryEditor
            value={searchTerm}
            onChange={onSearch}
            onClose={() => {
              onToggleSearch(false);
              onSearch('');
            }}
            typeFilter={typeFilter}
            onTypeFilter={onTypeFilter}
          />
        ) : (
          <FilePathBar
            currentPath={currentPath}
            homePath={homePath}
            osName={osName}
            onNavigate={onNavigate}
            onEditLocation={() => onTogglePathEdit(true)}
          />
        )}
      </div>

      <IconBtn
        label="Search this folder"
        active={isSearchOpen}
        onClick={() => {
          if (isSearchOpen) {
            onToggleSearch(false);
            onSearch('');
            return;
          }
          onTogglePathEdit(false);
          onToggleSearch(true);
        }}
      >
        <Search size={14} />
      </IconBtn>

      {!isNarrow && (
        <FileViewControls
          viewMode={viewMode}
          onToggleView={onToggleView}
          showHidden={showHidden}
          onToggleHidden={onToggleHidden}
          onZoomIn={onZoomIn}
          onZoomOut={onZoomOut}
          canZoomIn={canZoomIn}
          canZoomOut={canZoomOut}
          sortColumn={sortColumn}
          sortDirection={sortDirection}
          onSort={onSort}
        />
      )}

      <div className="relative" ref={menuRef}>
        <IconBtn label="New" active={isMenuOpen} onClick={() => setIsMenuOpen((open) => !open)}>
          <Plus size={15} />
        </IconBtn>
        {isMenuOpen && (
          <TopbarDropdown align="right" widthClass="w-52" className="z-50">
            {menuItem('New file', <FilePlus size={14} />, onNewFile)}
            {menuItem('New folder', <FolderPlus size={14} />, onNewFolder)}
            <div className="mx-2 my-1 h-px bg-app-border/20" />
            {menuItem('Upload files', <Upload size={14} />, onUpload)}
            {menuItem('Upload folder', <FolderInput size={14} />, onUploadFolder)}
            <div className="mx-2 my-1 h-px bg-app-border/20" />
            {menuItem('Open terminal here', <Terminal size={14} />, onOpenTerminal, !onOpenTerminal)}
            {menuItem('Reload', <RefreshCw size={14} />, onRefresh)}
            {menuItem(isBookmarked ? 'Unpin' : 'Pin folder', <Pin size={14} />, onBookmark)}
            {menuItem('Copy path', <Copy size={14} />, onCopyLocation)}
            <div className="mx-2 my-1 h-px bg-app-border/20" />
            {menuItem('Paste', <Clipboard size={14} />, onPaste, !onPaste || !canPaste)}
            {menuItem('Select all', undefined, onSelectAll, !onSelectAll)}
            {menuItem('Properties', <Info size={14} />, onProperties, !onProperties)}
          </TopbarDropdown>
        )}
      </div>
    </div>
  );
}

export const FileToolbar = memo(FileToolbarInner);

export function FileBottomActionBar({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="relative z-30 flex h-10 w-full shrink-0 items-center justify-between border-t border-app-border/20 bg-app-bg px-1.5">
      {children}
    </div>
  );
}
