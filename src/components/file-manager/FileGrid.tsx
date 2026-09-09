import {
  Folder,
} from 'lucide-react';
import { DynamicIcon } from '../ui/DynamicIcon';
import type React from 'react';
import { cn, formatBytes, formatDate } from '../../lib/utils';
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
          className="text-app-accent"
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

  return (
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
        'group relative cursor-pointer select-none overflow-hidden',
        viewMode === 'grid'
          ? cn(
            "flex flex-col items-center justify-start rounded-xl border border-transparent w-full h-full min-w-0 min-h-0",
            "hover:bg-app-surface/50",
            compactMode ? "p-2 gap-1" : "p-3 gap-2"
          )
          : cn(
            "flex items-center rounded-lg border border-transparent hover:bg-app-surface/50",
            compactMode ? "p-1.5" : "p-2"
          ),
        isSelected && (
          'bg-app-accent/20 text-app-accent shadow-sm'
        ),
        isFocused && !isSelected && 'ring-1 ring-app-accent/40',
        isFocused && isSelected && 'ring-1 ring-app-accent/60',
        !isSelected && viewMode === 'grid' && "hover:bg-app-surface/60"
      )}
    >
      <div className={cn(
        'flex items-center justify-center shrink-0',
        viewMode === 'grid' ? (compactMode ? 'w-full h-12' : 'w-full h-16') : 'w-10 mr-4',
        isFolder ? 'drop-shadow-sm' : 'text-app-muted/80 group-hover:text-app-text',
        isSelected && !isFolder && 'text-app-accent',
      )}>
        <FileIcon file={file} size={viewMode === 'grid' ? (compactMode ? 48 : 64) : (compactMode ? 16 : 22)} />
      </div>

      <div className="w-full text-center px-1 z-10 min-w-0">
        <div
          title={file.name}
          className={cn(
            'truncate font-medium leading-tight select-text',
            viewMode === 'grid' ? (compactMode ? 'text-[11px]' : 'text-xs') : 'text-sm',
            isSelected ? 'text-app-accent font-semibold' : 'text-app-text/90 group-hover:text-app-text',
          )}
        >
          {file.name}
        </div>

        {viewMode === 'grid' && !compactMode && (
          <div className="text-[10px] text-app-muted/50 truncate opacity-0 group-hover:opacity-100">
            {formatBytes(file.size)}
          </div>
        )}
      </div>
    </div>
  );
}));

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
        'h-full border-b border-app-border/20 cursor-pointer transition-colors outline-none',
        'grid items-center',
        'hover:bg-app-surface/40',
        isSelected && 'bg-app-accent/10 hover:bg-app-accent/15',
        isFocused && !isSelected && 'ring-1 ring-inset ring-app-accent/50 bg-app-surface/60',
        isFocused && isSelected && 'ring-1 ring-inset ring-app-accent',
      )}
      style={{ gridTemplateColumns: FILE_LIST_COLUMNS }}
    >
      <div className="py-2 px-4 min-w-0">
        <div className="flex items-center gap-3 min-w-0">
          <FileIcon file={file} size={20} />
          <span
            title={file.name}
            className={cn('font-medium truncate', isSelected ? 'text-app-accent' : 'text-app-text')}
          >
            {file.name}
          </span>
        </div>
      </div>
      <div className="py-2 px-4 text-sm text-app-muted font-mono">
        {isFolder ? '—' : formatBytes(file.size)}
      </div>
      <div className="py-2 px-4 text-sm text-app-muted">
        {isFolder ? 'Folder' : (file.name.split('.').pop()?.toUpperCase() || '—')}
      </div>
      <div className="py-2 px-4 text-sm text-app-muted">
        {formatDate(file.lastModified)}
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
    <div style={style} {...ariaAttributes}>
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
    <div style={{ ...style, contain: 'layout paint' }} {...ariaAttributes} className="min-w-0 p-1">
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
    if (index < 0) return;
    gridRef.current?.scrollToCell({
      rowIndex: Math.floor(index / columnCount),
      columnIndex: index % columnCount,
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

  useEffect(() => {
    if (!focusedFile) return;
    if (viewMode === 'list') {
      scrollFocusedListRow();
      return;
    }
    if (viewMode === 'grid') {
      scrollFocusedGridCell(gridColumnCountRef.current);
    }
  }, [focusedFile, viewMode, compactMode, scrollFocusedListRow, scrollFocusedGridCell]);

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
            className="shrink-0 grid items-center min-w-0 text-left text-xs text-app-muted uppercase tracking-wider bg-app-panel/95 backdrop-blur-sm z-10 border-b border-app-border/40"
            style={{ gridTemplateColumns: FILE_LIST_COLUMNS, paddingRight: getScrollbarSize() }}
          >
            {(['name', 'size', 'type', 'modified'] as const).map((column) => (
              <button
                key={column}
                type="button"
                className="py-3 px-4 text-left cursor-pointer hover:bg-app-surface/30 transition-colors group"
                onClick={() => onSort(column)}
              >
                <span className="flex items-center gap-2">
                  {column === 'name' ? 'Name' : column === 'size' ? 'Size' : column === 'type' ? 'Type' : 'Modified'}
                  {sortColumn === column && (sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />)}
                  {sortColumn !== column && <ArrowUpDown size={14} className="opacity-0 group-hover:opacity-40" />}
                </span>
              </button>
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
              if (el) el.scrollLeft = 0;
              if (!focusedFile) {
                if (el) el.scrollTop = 0;
                return;
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

