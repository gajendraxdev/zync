import { ChevronDown, Eye, LayoutGrid, LayoutList, Minus, Plus } from 'lucide-react';
import { memo } from 'react';
import { FileActionMenu } from './FileActionMenu';
import { FILE_LIST_SORT_INITIAL, FILE_LIST_COLUMN_IDS, FILE_LIST_COLUMN_LABELS, fileListSortSense, type FileSortColumn, type FileSortDirection } from './fileGridLayout';
import { FILE_DETAIL_COLUMNS, type FileDetailColumn } from './fileListPresentation';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';

/** One view menu on every pane width; hidden list columns remain sortable here. */
export const FileViewControls = memo(function FileViewControls({
  viewMode, onToggleView, showHidden, onToggleHidden, onZoomIn, onZoomOut,
  canZoomIn, canZoomOut, sortColumn, sortDirection, onSort,
  detailColumns, onToggleColumn,
}: {
  viewMode: 'grid' | 'list';
  onToggleView: (mode: 'grid' | 'list') => void;
  showHidden: boolean;
  onToggleHidden: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
  sortColumn: FileSortColumn;
  sortDirection: FileSortDirection;
  onSort: (column: FileSortColumn, direction: FileSortDirection) => void;
  detailColumns: readonly FileDetailColumn[];
  onToggleColumn: (column: FileDetailColumn) => void;
}) {
  const reversed = sortDirection !== FILE_LIST_SORT_INITIAL[sortColumn];
  return <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label="File view">
    <Tooltip content="List view" position="bottom"><IconButton label="List view" icon={<LayoutList size={14} />}
      className="aria-pressed:bg-app-surface/70 aria-pressed:text-app-accent"
      aria-pressed={viewMode === 'list'} onClick={() => onToggleView('list')} /></Tooltip>
    <Tooltip content="Grid view" position="bottom"><IconButton label="Grid view" icon={<LayoutGrid size={14} />}
      className="aria-pressed:bg-app-surface/70 aria-pressed:text-app-accent"
      aria-pressed={viewMode === 'grid'} onClick={() => onToggleView('grid')} /></Tooltip>
    <FileActionMenu label="View" tooltip={`View · ${FILE_LIST_COLUMN_LABELS[sortColumn]}, ${fileListSortSense(sortColumn, sortDirection)}`}
    icon={<ChevronDown size={13} />} iconOnly items={[
    { label: 'Grid view', checked: viewMode === 'grid', checkType: 'radio', action: () => onToggleView('grid') },
    { label: 'List view', checked: viewMode === 'list', checkType: 'radio', action: () => onToggleView('list') },
    { separator: true },
    { label: 'Sort by', children: FILE_LIST_COLUMN_IDS.map(column => ({
      label: FILE_LIST_COLUMN_LABELS[column], checked: sortColumn === column, checkType: 'radio',
      action: () => onSort(column, FILE_LIST_SORT_INITIAL[column]),
    })) },
    { label: 'Reverse order', checked: reversed, action: () => onSort(sortColumn,
      reversed ? FILE_LIST_SORT_INITIAL[sortColumn] : (sortDirection === 'asc' ? 'desc' : 'asc')) },
    { label: 'Columns in this pane', children: FILE_DETAIL_COLUMNS.map(column => ({
      label: FILE_LIST_COLUMN_LABELS[column], checked: detailColumns.includes(column),
      action: () => onToggleColumn(column),
    })) },
    { separator: true },
    { label: 'Larger icons', icon: <Plus size={13} />, disabled: !canZoomIn, action: onZoomIn },
    { label: 'Smaller icons', icon: <Minus size={13} />, disabled: !canZoomOut, action: onZoomOut },
    { separator: true },
    { label: 'Show hidden files', icon: <Eye size={13} />, checked: showHidden, action: onToggleHidden },
  ]} />
  </div>;
});
