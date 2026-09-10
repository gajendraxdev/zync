import {
  Folder,
} from 'lucide-react';
import { DynamicIcon } from '../ui/DynamicIcon';
import type React from 'react';
import { cn, formatBytes } from '../../lib/utils';
import { Tooltip } from '../ui/Tooltip';
import type { FileEntry } from './types';
import { useAppStore } from '../../store/useAppStore';
import { useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef, memo, type CSSProperties } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { setCurrentDragSource } from '../../lib/dragDrop';
import { motion, AnimatePresence } from 'framer-motion';
import { forwardRef } from 'react';
import { buildDragData, startInternalDrag, validateAndBuildMoves } from './dragDropUtils';
import { getScrollbarSize, Grid, List, useGridRef, useListRef } from 'react-window';
import {
  computeFileGridMetrics,
  fileGridScrollTarget,
  formatFileIdentity,
  formatFileListDate,
  fileListSortTooltip,
  FILE_LIST_COLUMN_ALIGN,
  FILE_LIST_COLUMN_IDS,
  FILE_LIST_COLUMN_LABELS,
  FILE_LIST_COLUMNS,
  FILE_LIST_ROW_HEIGHT,
  type FileSortColumn,
  type FileSortDirection,
} from './fileGridLayout';

// Extended Icon Selector with Colors
const FileIcon = memo(function FileIcon({ file, size }: { file: FileEntry; size: number }) {
  if (file.type === 'd') {
    // Theme-based: Solid Accent Folder
    return (
      <div className="relative flex items-center justify-center">
        <Folder
          size={size}
          fill="currentColor"
          className="text-app-accent drop-shadow-sm"
          strokeWidth={0.5}
        />
      </div>
    );
  }

  // Use the new DynamicIcon engine for files
  return (
    <DynamicIcon
        type={file.name}
        size={size}
    />
  );
});

// Memoized File Item Component
const FileGridItem = memo(forwardRef<HTMLDivElement, {
  file: FileEntry;
  viewMode: 'grid' | 'list';
  compactMode: boolean;
  isSelected: boolean;
  isFocused: boolean;
  connectionId?: string;
  currentPath?: string;
  getSelectedFiles: () => string[];
  onSelect: (name: string, multi: boolean) => void;
  onNavigate: (name: string) => void;
  onContextMenu: (e: React.MouseEvent, file?: FileEntry) => void;
  onMove?: (moves: { source: string; target: string; sourceConnectionId?: string }[]) => void;
}>(({
  file,
  viewMode,
  compactMode,
  isSelected,
  isFocused,
  connectionId,
  currentPath,
  getSelectedFiles,
  onSelect,
  onNavigate,
  onContextMenu,
  onMove
}, ref) => {
  const isFolder = file.type === 'd';
  const identity = formatFileIdentity(file.owner || '', file.group || '');
  const modified = formatFileListDate(file.lastModified);
  const kind = isFolder ? 'Folder' : formatBytes(file.size);
  const hint = [file.name, kind, identity, modified].filter(Boolean).join('\n');

  return (
    <Tooltip
      content={hint}
      position="bottom"
      className="min-w-0 w-full items-start justify-center"
      contentClassName="max-w-[16rem] whitespace-pre-line text-left leading-snug font-normal"
    >
    <div
      ref={ref}
      id={`file-item-${file.name}`}
      draggable={connectionId !== undefined}
      onDragStart={(e: any) => {
        if (!connectionId || !currentPath) return;
        const selectedFiles = getSelectedFiles();
        const dragData = buildDragData(file, isSelected, selectedFiles, connectionId, currentPath);
        const count = isSelected && selectedFiles.length > 0 ? selectedFiles.length : 1;
        startInternalDrag(e, dragData, isFolder, count);
      }}
      onDragEnd={(e: any) => {
        setCurrentDragSource(null);
        if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1';
      }}
      onDragOver={(e: any) => {
        if (!isFolder || !onMove) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (e.currentTarget instanceof HTMLElement) {
          e.currentTarget.style.outline = '2px dashed var(--color-app-accent)';
          e.currentTarget.style.outlineOffset = '-2px';
        }
      }}
      onDragLeave={(e: any) => {
        if (!isFolder || !onMove) return;
        if (e.currentTarget instanceof HTMLElement) {
          e.currentTarget.style.outline = 'none';
        }
      }}
      onDrop={(e: any) => {
        if (!isFolder || !onMove || !currentPath) return;

        // Only handle internal drops, let external drops bubble up
        if (!e.dataTransfer.types.includes('application/json')) return;
        
        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.outline = 'none';

        try {
          const data = JSON.parse(e.dataTransfer.getData('application/json'));
          if (data && onMove) {
            const targetFolder = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
            const moves = validateAndBuildMoves(data, targetFolder);
            if (moves.length > 0) onMove(moves);
          }
        } catch (err) {
          console.error('Failed to parse drag data', err);
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
        onSelect(file.name, isMulti);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onNavigate(file.name);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        if (!isSelected) onSelect(file.name, false);
        onContextMenu(e, file);
      }}
      className={cn(
        'group relative cursor-pointer select-none',
        viewMode === 'grid'
          ? cn(
            'flex flex-col items-center w-full min-w-0 rounded-md transition-colors duration-75',
            compactMode ? 'px-1 py-1 gap-0.5' : 'px-1.5 py-1.5 gap-1',
            isSelected
              ? 'bg-app-accent/20'
              : 'bg-transparent hover:bg-app-surface/55',
          )
          : cn(
            'flex items-center rounded-lg border border-transparent hover:bg-app-surface/50',
            compactMode ? 'p-1.5' : 'p-2',
          ),
        isFocused && !isSelected && (viewMode === 'grid' ? 'bg-app-surface/70' : 'ring-1 ring-app-accent/35'),
      )}
    >
      <div className={cn(
        'flex items-center justify-center shrink-0',
        viewMode === 'grid' ? 'w-full' : 'w-10 mr-4',
        isFolder ? 'drop-shadow-sm' : 'text-app-muted/80',
      )}>
        <FileIcon file={file} size={viewMode === 'grid' ? (compactMode ? 40 : 56) : (compactMode ? 16 : 22)} />
      </div>

      <div className="w-full text-center px-1 min-w-0">
        <div
          className={cn(
            'select-text',
            viewMode === 'grid'
              ? cn(
                'line-clamp-2 break-words [overflow-wrap:anywhere] leading-[1.25]',
                compactMode ? 'text-[11px]' : 'text-[12px]',
              )
              : 'truncate text-sm leading-snug',
            isSelected ? 'text-app-text' : 'text-app-text/85',
          )}
        >
          {file.name}
        </div>
      </div>
    </div>
    </Tooltip>
  );
}));

function FileIdentityText({ owner, group }: { owner: string; group: string }) {
  const label = formatFileIdentity(owner, group);
  if (!label) return <span>—</span>;
  return <span className="block truncate font-mono text-[12px] tracking-tight">{label}</span>;
}

// Memoized File List Item Component — plain div (windowed rows must not replay motion enter).
const FileListItem = memo(forwardRef<HTMLDivElement, {
  file: FileEntry;
  isSelected: boolean;
  isFocused: boolean;
  connectionId?: string;
  currentPath?: string;
  getSelectedFiles: () => string[];
  onSelect: (name: string, multi: boolean) => void;
  onNavigate: (name: string) => void;
  onContextMenu: (e: React.MouseEvent, file?: FileEntry) => void;
  onMove?: (moves: { source: string; target: string; sourceConnectionId?: string }[]) => void;
}>(({
  file,
  isSelected,
  isFocused,
  connectionId,
  currentPath,
  getSelectedFiles,
  onSelect,
  onNavigate,
  onContextMenu,
  onMove
}, ref) => {
  const isFolder = file.type === 'd';

  return (
    <div
      ref={ref}
      role="row"
      id={`file-item-${file.name}`}
      draggable={connectionId !== undefined}
      onDragStart={(e: any) => {
        if (!connectionId || !currentPath) return;
        const selectedFiles = getSelectedFiles();
        const dragData = buildDragData(file, isSelected, selectedFiles, connectionId, currentPath);
        const count = isSelected && selectedFiles.length > 0 ? selectedFiles.length : 1;
        startInternalDrag(e, dragData, isFolder, count);
      }}
      onDragEnd={(e: any) => {
        setCurrentDragSource(null);
        if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.opacity = '1';
      }}
      onDragOver={(e: any) => {
        if (!isFolder || !onMove) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (e.currentTarget instanceof HTMLElement) {
          e.currentTarget.style.outline = '2px dashed var(--color-app-accent)';
        }
      }}
      onDragLeave={(e: any) => {
        if (e.currentTarget instanceof HTMLElement) {
          e.currentTarget.style.outline = 'none';
        }
      }}
      onDrop={(e: any) => {
        if (!isFolder || !onMove || !currentPath) return;

        // Only handle internal drops, let external drops bubble up
        if (!e.dataTransfer.types.includes('application/json')) return;

        e.preventDefault();
        e.stopPropagation();
        if (e.currentTarget instanceof HTMLElement) e.currentTarget.style.outline = 'none';

        try {
          const data = JSON.parse(e.dataTransfer.getData('application/json'));
          if (data && onMove) {
            const targetFolder = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
            const moves = validateAndBuildMoves(data, targetFolder);
            if (moves.length > 0) onMove(moves);
          }
        } catch (err) {
          console.error('Failed to parse drag data', err);
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        const isMulti = e.ctrlKey || e.metaKey || e.shiftKey;
        onSelect(file.name, isMulti);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onNavigate(file.name);
      }}
      onContextMenu={(e) => {
        e.stopPropagation();
        if (!isSelected) onSelect(file.name, false);
        onContextMenu(e, file);
      }}
      className={cn(
        'h-full w-full min-w-0 border-b border-app-border/15 cursor-pointer transition-colors outline-none',
        'grid items-center overflow-hidden',
        'hover:bg-app-surface/40',
        isSelected && 'bg-app-accent/10 hover:bg-app-accent/14',
        isFocused && !isSelected && 'bg-app-surface/55',
        isFocused && isSelected && 'bg-app-accent/14',
      )}
      style={{ gridTemplateColumns: FILE_LIST_COLUMNS }}
    >
      <div className="py-2 px-4 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="shrink-0">
            <FileIcon file={file} size={18} />
          </span>
          <span
            title={file.name}
            className={cn('truncate text-[13px]', isSelected ? 'text-app-accent font-medium' : 'text-app-text')}
          >
            {file.name}
          </span>
        </div>
      </div>
      <div className="py-2 px-3 min-w-0 overflow-hidden text-[12px] text-app-muted font-mono tabular-nums truncate text-right">
        {isFolder ? '—' : formatBytes(file.size)}
      </div>
      <div className="py-2 px-3 min-w-0 overflow-hidden text-app-muted">
        <Tooltip
          content={`Owner ${file.owner || '—'} · Group ${file.group || '—'}`}
          position="top"
          disabled={!file.owner && !file.group}
          className="min-w-0 w-full justify-start"
        >
          <div className="min-w-0 w-full">
            <FileIdentityText owner={file.owner} group={file.group} />
          </div>
        </Tooltip>
      </div>
      <div className="py-2 px-3 min-w-0 overflow-hidden text-[12px] text-app-muted tabular-nums truncate text-right">
        {formatFileListDate(file.lastModified) || '—'}
      </div>
    </div>
  );
}));

FileGridItem.displayName = 'FileGridItem';
FileListItem.displayName = 'FileListItem';

interface FileGridProps {
  files: FileEntry[];
  selectedFiles: string[];
  onSelect: (name: string, multi: boolean) => void;
  onNavigate: (name: string) => void;
  onContextMenu: (e: React.MouseEvent, file?: FileEntry) => void;
  viewMode: 'grid' | 'list';
  isLoading: boolean;
  connectionId?: string;
  currentPath?: string;
  focusedFile?: string | null;
  onMove?: (moves: { source: string; target: string; sourceConnectionId?: string }[]) => void;
  sortColumn: FileSortColumn;
  sortDirection: FileSortDirection;
  onSort: (column: FileSortColumn) => void;
  onGridColumnCount?: (columnCount: number) => void;
}

type FileListRowExtra = {
  files: FileEntry[];
  selectedSet: Set<string>;
  focusedFile?: string | null;
  connectionId?: string;
  currentPath?: string;
  getSelectedFiles: () => string[];
  onSelect: (name: string, multi: boolean) => void;
  onNavigate: (name: string) => void;
  onContextMenu: (e: React.MouseEvent, file?: FileEntry) => void;
  onMove?: (moves: { source: string; target: string; sourceConnectionId?: string }[]) => void;
};

function FileListRow({
  index,
  style,
  ariaAttributes,
  files,
  selectedSet,
  focusedFile,
  connectionId,
  currentPath,
  getSelectedFiles,
  onSelect,
  onNavigate,
  onContextMenu,
  onMove,
}: {
  index: number;
  style: CSSProperties;
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' };
} & FileListRowExtra) {
  const file = files[index];
  if (!file) return null;
  return (
    <div style={style} {...ariaAttributes} className="min-w-0 overflow-hidden">
      <FileListItem
        file={file}
        isSelected={selectedSet.has(file.name)}
        isFocused={focusedFile === file.name}
        connectionId={connectionId}
        currentPath={currentPath}
        getSelectedFiles={getSelectedFiles}
        onSelect={onSelect}
        onNavigate={onNavigate}
        onContextMenu={onContextMenu}
        onMove={onMove}
      />
    </div>
  );
}

type FileGridCellExtra = FileListRowExtra & {
  columnCount: number;
  compactMode: boolean;
};

function FileGridCell({
  columnIndex,
  rowIndex,
  style,
  ariaAttributes,
  files,
  columnCount,
  compactMode,
  selectedSet,
  focusedFile,
  connectionId,
  currentPath,
  getSelectedFiles,
  onSelect,
  onNavigate,
  onContextMenu,
  onMove,
}: {
  columnIndex: number;
  rowIndex: number;
  style: CSSProperties;
  ariaAttributes: { 'aria-colindex': number; role: 'gridcell' };
} & FileGridCellExtra) {
  const index = rowIndex * columnCount + columnIndex;
  const file = files[index];
  if (!file) {
    return <div style={style} />;
  }
  return (
    <div style={{ ...style, contain: 'layout paint' }} {...ariaAttributes} className="min-w-0 flex items-start justify-center p-1">
      <FileGridItem
        file={file}
        viewMode="grid"
        compactMode={compactMode}
        isSelected={selectedSet.has(file.name)}
        isFocused={focusedFile === file.name}
        connectionId={connectionId}
        currentPath={currentPath}
        getSelectedFiles={getSelectedFiles}
        onSelect={onSelect}
        onNavigate={onNavigate}
        onContextMenu={onContextMenu}
        onMove={onMove}
      />
    </div>
  );
}

export const FileGrid = memo(function FileGrid({
  files,
  selectedFiles,
  onSelect,
  onNavigate,
  onContextMenu,
  viewMode,
  isLoading,
  connectionId,
  currentPath,
  focusedFile,
  onMove,
  sortColumn,
  sortDirection,
  onSort,
  onGridColumnCount,
}: FileGridProps) {
  const compactMode = useAppStore(state => state.settings.compactMode);
  const listRef = useListRef(null);
  const gridRef = useGridRef(null);
  const gridColumnCountRef = useRef(1);
  const lastReportedColumnCountRef = useRef<number | null>(null);
  const [gridViewportWidth, setGridViewportWidth] = useState(0);
  const selectedFilesRef = useRef(selectedFiles);
  const getSelectedFiles = useCallback(() => selectedFilesRef.current, []);
  useLayoutEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);
  const selectedSet = useMemo(() => new Set(selectedFiles), [selectedFiles]);

  const reportColumnCount = useCallback((count: number) => {
    gridColumnCountRef.current = count;
    if (lastReportedColumnCountRef.current === count) return;
    lastReportedColumnCountRef.current = count;
    onGridColumnCount?.(count);
  }, [onGridColumnCount]);

  const scrollFocusedListRow = useCallback(() => {
    if (viewMode !== 'list' || !focusedFile) return;
    const index = files.findIndex((f) => f.name === focusedFile);
    if (index < 0) return;
    listRef.current?.scrollToRow({ index, align: 'smart', behavior: 'auto' });
  }, [viewMode, focusedFile, files, listRef]);

  const scrollFocusedGridCell = useCallback((columnCount: number) => {
    if (viewMode !== 'grid' || !focusedFile || columnCount < 1) return;
    const index = files.findIndex((f) => f.name === focusedFile);
    const rowCount = Math.max(1, Math.ceil(files.length / columnCount));
    const target = fileGridScrollTarget(index, columnCount, rowCount);
    if (!target) return;
    gridRef.current?.scrollToCell({
      rowIndex: target.rowIndex,
      columnIndex: target.columnIndex,
      rowAlign: 'smart',
      columnAlign: 'smart',
      behavior: 'auto',
    });
  }, [viewMode, focusedFile, files, gridRef]);

  useLayoutEffect(() => {
    const listEl = listRef.current?.element;
    if (listEl) listEl.scrollTop = 0;
    const gridEl = gridRef.current?.element;
    if (gridEl) {
      gridEl.scrollTop = 0;
      gridEl.scrollLeft = 0;
    }
  }, [currentPath, listRef, gridRef]);

  const listRowProps = useMemo(
    () => ({
      files,
      selectedSet,
      focusedFile,
      connectionId,
      currentPath,
      getSelectedFiles,
      onSelect,
      onNavigate,
      onContextMenu,
      onMove,
    }),
    [
      files,
      selectedSet,
      focusedFile,
      connectionId,
      currentPath,
      getSelectedFiles,
      onSelect,
      onNavigate,
      onContextMenu,
      onMove,
    ],
  );

  const gridMetrics = useMemo(
    () => computeFileGridMetrics(gridViewportWidth, compactMode),
    [gridViewportWidth, compactMode],
  );
  const gridColumnWidth = Math.max(
    1,
    gridViewportWidth > 0 ? gridViewportWidth / gridMetrics.columnCount : gridMetrics.columnWidth,
  );
  const gridRowCount = Math.max(1, Math.ceil(files.length / gridMetrics.columnCount));

  useEffect(() => {
    reportColumnCount(gridMetrics.columnCount);
  }, [gridMetrics.columnCount, reportColumnCount]);

  useLayoutEffect(() => {
    if (!focusedFile) return;
    if (viewMode === 'list') {
      scrollFocusedListRow();
      return;
    }
    scrollFocusedGridCell(gridMetrics.columnCount);
  }, [
    focusedFile,
    viewMode,
    compactMode,
    gridMetrics.columnCount,
    files.length,
    scrollFocusedListRow,
    scrollFocusedGridCell,
  ]);




  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: <explanation>
    <div
      className="flex-1 min-h-0 min-w-0 overflow-hidden p-4 relative flex flex-col"
      onClick={() => onSelect('', false)}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e);
      }}
      onDragOver={(e) => {
        const types = Array.from(e.dataTransfer.types || []);
        const isInternal = types.includes('application/json');
        const isExternal = types.includes('Files') || types.includes('text/uri-list');

        if (isInternal || isExternal) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          e.currentTarget.style.backgroundColor = 'var(--color-app-accent-transparent, rgba(var(--color-app-accent-rgb), 0.05))';
        }
      }}
      onDragLeave={(e) => {
        e.currentTarget.style.backgroundColor = '';
      }}
      onDrop={(e) => {
        e.currentTarget.style.backgroundColor = '';
        // Always prevent default to stop WebView from navigating to dropped file URL
        e.preventDefault();
        
        const types = Array.from(e.dataTransfer.types || []);
        const isExternal = types.includes('Files') || types.includes('text/uri-list');
        if (isExternal) {
            e.stopPropagation();
            useAppStore.getState().showToast('info', 'External drop here is currently disabled. We are working to bring this feature to Zync soon!');
            return;
        }
    }}
    >
      {/* Smooth Native Progress Bar */}
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0, scaleX: 0 }}
            animate={{ opacity: 1, scaleX: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="absolute top-0 left-0 right-0 h-0.5 bg-app-accent origin-left z-50 overflow-hidden shadow-[0_0_8px_rgba(var(--color-app-accent-rgb),0.5)]"
          >
            <motion.div
               animate={{ x: ['-100%', '200%'] }}
               transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
               className="h-full w-1/3 bg-white/30"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div className={cn(
        "flex-1 min-h-0 w-full",
        isLoading && "pointer-events-none cursor-wait"
      )}>
        {files.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex-1 flex flex-col items-center justify-center text-app-muted opacity-50 select-none pb-20 h-full"
            onContextMenu={(e) => onContextMenu(e)}
          >
            <Folder size={64} className="mb-4 stroke-1" />
            <p className="text-lg font-medium opacity-80">Empty directory</p>
            {(() => {
              // Only show upload prompt if user is actually dragging external files
              // OR if nothing is being dragged (default state)
              return <p className="text-sm opacity-50">Drag files here to upload</p>;
            })()}
          </motion.div>
        ) : viewMode === 'list' ? (
        <div className="flex flex-col h-full min-h-0">
          <div
            className="shrink-0 grid items-center w-full min-w-0 overflow-hidden text-[11px] font-medium text-app-muted/80 bg-app-panel/95 backdrop-blur-sm z-10 border-b border-app-border/30"
            style={{ gridTemplateColumns: FILE_LIST_COLUMNS, paddingRight: getScrollbarSize() }}
          >
            {FILE_LIST_COLUMN_IDS.map((column) => (
              <Tooltip
                key={column}
                content={fileListSortTooltip(column, sortColumn, sortDirection)}
                position="bottom"
                className={cn(
                  'min-w-0 w-full',
                  FILE_LIST_COLUMN_ALIGN[column] === 'right' ? 'justify-end' : 'justify-start',
                )}
              >
                <button
                  type="button"
                  aria-sort={
                    sortColumn === column
                      ? (sortDirection === 'asc' ? 'ascending' : 'descending')
                      : 'none'
                  }
                  className={cn(
                    'min-w-0 w-full overflow-hidden py-2 cursor-pointer hover:text-app-text hover:bg-app-surface/25 transition-colors group',
                    column === 'name' ? 'px-4' : 'px-3',
                    FILE_LIST_COLUMN_ALIGN[column] === 'right' ? 'text-right' : 'text-left',
                    sortColumn === column && 'text-app-text',
                  )}
                  onClick={() => onSort(column)}
                >
                  <span
                    className={cn(
                      'flex items-center gap-1 min-w-0',
                      FILE_LIST_COLUMN_ALIGN[column] === 'right' && 'justify-end',
                    )}
                  >
                    <span className="truncate">{FILE_LIST_COLUMN_LABELS[column]}</span>
                    {sortColumn === column && (sortDirection === 'asc' ? <ArrowUp size={12} className="shrink-0 text-app-accent" /> : <ArrowDown size={12} className="shrink-0 text-app-accent" />)}
                    {sortColumn !== column && <ArrowUpDown size={12} className="shrink-0 opacity-25 group-hover:opacity-70" />}
                  </span>
                </button>
              </Tooltip>
            ))}
          </div>
          <div className="flex-1 min-h-0 min-w-0">
            <List
              listRef={listRef}
              rowCount={files.length}
              rowHeight={FILE_LIST_ROW_HEIGHT}
              rowComponent={FileListRow}
              rowProps={listRowProps}
              overscanCount={4}
              style={{ height: '100%', width: '100%' }}
              onResize={() => scrollFocusedListRow()}
            />
          </div>
        </div>
      ) : (
        <div className="h-full w-full min-h-0 min-w-0">
          <Grid
            gridRef={gridRef}
            cellComponent={FileGridCell}
            cellProps={{
              ...listRowProps,
              columnCount: gridMetrics.columnCount,
              compactMode,
            }}
            columnCount={gridMetrics.columnCount}
            columnWidth={gridColumnWidth}
            rowCount={gridRowCount}
            rowHeight={gridMetrics.rowHeight}
            overscanCount={1}
            style={{ height: '100%', width: '100%', overflowX: 'hidden' }}
            onResize={({ width }) => {
              setGridViewportWidth(width);
              const next = computeFileGridMetrics(width, compactMode);
              gridColumnCountRef.current = next.columnCount;
              reportColumnCount(next.columnCount);
              const el = gridRef.current?.element;
              if (el) {
                el.scrollLeft = 0;
                if (!focusedFile) el.scrollTop = 0;
              }
              scrollFocusedGridCell(next.columnCount);
            }}
          />
        </div>
      )}
      </div>
    </div>
  );
});

