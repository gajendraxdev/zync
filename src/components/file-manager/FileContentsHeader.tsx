import { Clipboard, Copy, Info, Loader2, MoreHorizontal, Pin, RefreshCw, Search, Terminal, X } from 'lucide-react';
import { useRef, type ComponentProps } from 'react';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { FileActionMenu } from './FileActionMenu';
import { FileQueryEditor, type FileSearchTypeFilter } from './FileQueryEditor';
import { FileViewControls } from './FileViewControls';
import { fileSelectionSizeLabel, type FileSelectionSummary } from './fileSelectionSummary';
import { MAX_FOLDER_SIZE_BATCH } from '../../features/files/domain/folderSizes';

const counted = (count: number, label: string) => `${count} ${label}${count === 1 ? '' : 's'}`;

/** Presentation-only folder chrome. Counts and actions stay owned by the live Files surface. */
export function FileContentsHeader({
  folderName, visibleCount, totalCount, selection, loading, searchTerm, onSearch, isSearchOpen,
  onToggleSearch, typeFilter, onTypeFilter, isPropertiesOpen, onProperties,
  onRefresh, onCopyLocation, onBookmark, isBookmarked, onOpenTerminal,
  onPaste, canPaste, onSelectAll, onClearSelection, disabled, view,
  folderSizes,
}: {
  folderName: string;
  visibleCount: number;
  totalCount: number;
  selection: FileSelectionSummary;
  loading: boolean;
  searchTerm: string;
  onSearch: (term: string) => void;
  isSearchOpen: boolean;
  onToggleSearch: (open: boolean) => void;
  typeFilter: FileSearchTypeFilter;
  onTypeFilter: (value: FileSearchTypeFilter) => void;
  isPropertiesOpen: boolean;
  onProperties: () => void;
  onRefresh: () => void;
  onCopyLocation: () => void;
  onBookmark: () => void;
  isBookmarked: boolean;
  onOpenTerminal?: () => void;
  onPaste: () => void;
  canPaste: boolean;
  onSelectAll: () => void;
  onClearSelection: () => void;
  disabled: boolean;
  view: ComponentProps<typeof FileViewControls>;
  folderSizes?: { active: boolean; limited: boolean; cancel: () => void };
}) {
  const searchTrigger = useRef<HTMLButtonElement>(null);
  const selectedCount = selection.count;
  const selectedSize = fileSelectionSizeLabel(selection);
  const selectionHint = selectedCount > 0
    ? `${selectedCount} selected. ${counted(selection.files, 'file')}, ${counted(selection.folders, 'folder')}, ${counted(selection.links, 'link')}. ${selectedSize ? `${selectedSize}. ` : ''}Folder contents are included only when calculated; link targets are not counted.${selection.unknownSizes || selection.partialSizes ? ' The total is incomplete, not a guaranteed lower bound.' : ''}`
    : '';
  const inventory = searchTerm || typeFilter !== 'all' ? `${visibleCount} of ${totalCount} shown` : counted(totalCount, 'item');
  const closeSearch = () => {
    onSearch('');
    onTypeFilter('all');
    onToggleSearch(false);
    searchTrigger.current?.focus({ preventScroll: true });
  };
  return <header className="files-contents-header relative z-20 shrink-0">
    <div className="files-summary flex min-h-9 min-w-0 items-center gap-1 py-1">
      <div className="files-summary-main min-w-0 flex-1 pr-2">
        <h2 className="sr-only">{folderName || 'Files'}</h2>
        <div className={`files-summary-count flex min-h-4 items-center gap-1.5 text-xs ${selectedCount > 0 ? 'font-bold text-app-accent' : 'text-app-muted'}`}>
          {loading ? <><Loader2 size={11} aria-hidden="true" className="animate-spin motion-reduce:animate-none" /><span>Loading…</span></>
            : <Tooltip content={selectionHint} disabled={!selectedCount} position="bottom" contentClassName="max-w-xs whitespace-normal">
              <span>
                <span aria-hidden={selectedCount > 0 || undefined}>{selectedCount > 0 ? `${selectedCount} selected${selectedSize ? ` · ${selectedSize}` : ''} · ` : ''}{inventory}</span>
                {selectedCount > 0 && <span className="sr-only">{selectionHint} {inventory}</span>}
              </span>
            </Tooltip>}
        </div>
      </div>
      <span className="sr-only" role="status">{loading ? 'Loading folder' : `${visibleCount} ${visibleCount === 1 ? 'item' : 'items'} available`}</span>
      {isSearchOpen && <div className="files-summary-filter flex h-7 min-w-0 w-[min(22rem,45%)]">
        <FileQueryEditor value={searchTerm} onChange={onSearch} onClose={closeSearch} typeFilter={typeFilter} onTypeFilter={onTypeFilter} />
      </div>}
      <Tooltip content="Filter this folder" position="bottom">
        <IconButton ref={searchTrigger} label="Filter this folder" icon={<Search size={14} />} aria-pressed={isSearchOpen}
          onClick={() => isSearchOpen ? closeSearch() : onToggleSearch(true)} />
      </Tooltip>
      <FileViewControls {...view} />
      <Tooltip content={isPropertiesOpen ? 'Hide properties' : 'Inspect selection'} position="bottom">
        <IconButton label={isPropertiesOpen ? 'Hide properties' : 'Inspect selection'} icon={<Info size={14} />}
          aria-pressed={isPropertiesOpen} onClick={onProperties} />
      </Tooltip>
      <Tooltip content="Clear selection" position="bottom" className={selectedCount === 0 ? 'invisible' : ''}>
        <IconButton label="Clear selection" icon={<X size={14} />} disabled={selectedCount === 0} onClick={onClearSelection} />
      </Tooltip>
      <FileActionMenu label="Folder actions" icon={<MoreHorizontal size={15} />} iconOnly items={[
        { label: 'Reload', icon: <RefreshCw size={14} />, disabled: loading || disabled, action: onRefresh },
        ...(folderSizes?.active ? [{ label: 'Cancel folder-size calculation',
          icon: <X size={14} />, disabled, action: folderSizes.cancel }] : []),
        { label: isBookmarked ? 'Unpin folder' : 'Pin folder', icon: <Pin size={14} />, disabled, action: onBookmark },
        { label: 'Copy path', icon: <Copy size={14} />, disabled, action: onCopyLocation },
        { label: 'Open terminal here', icon: <Terminal size={14} />, disabled: disabled || !onOpenTerminal, action: () => onOpenTerminal?.() },
        { separator: true },
        { label: 'Paste', icon: <Clipboard size={14} />, disabled: disabled || !canPaste, action: onPaste },
        { label: 'Select all', disabled: disabled || visibleCount === 0, action: onSelectAll },
      ]} />
    </div>
    {folderSizes?.limited && <p role="status" className="pb-1 text-xs text-app-muted">Automatic calculation is limited to the first {MAX_FOLDER_SIZE_BATCH} folders. Calculate another folder from Properties.</p>}
  </header>;
}
