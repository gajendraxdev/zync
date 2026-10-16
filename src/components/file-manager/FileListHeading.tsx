import { ArrowDown, ArrowUp } from 'lucide-react';
import { getScrollbarSize } from 'react-window';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/utils';
import { FILE_LIST_COLUMN_ALIGN, FILE_LIST_COLUMN_LABELS, fileListSortTooltip, type FileSortColumn, type FileSortDirection } from './fileGridLayout';

/** Sort controls are outside the selection widget; headings and rows share the same tracks. */
export function FileListHeading({ columns, sortColumn, sortDirection, onSort }: {
  columns: readonly FileSortColumn[];
  sortColumn: FileSortColumn;
  sortDirection: FileSortDirection;
  onSort: (column: FileSortColumn) => void;
}) {
  return <div className="files-list-columns grid shrink-0 items-center border-b border-app-border/30 text-xs text-app-muted"
    style={{ paddingRight: getScrollbarSize() }} onClick={event => event.stopPropagation()}>
    {columns.map(column => <Tooltip key={column} content={fileListSortTooltip(column, sortColumn, sortDirection)} position="bottom">
      <button type="button" aria-label={fileListSortTooltip(column, sortColumn, sortDirection)} aria-pressed={column === sortColumn}
        className={cn(`files-list-column-${column}`, 'h-8 min-w-0 px-2 text-left hover:bg-app-surface/30 hover:text-app-text focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-control-focus',
          column === 'name' && 'files-name-heading', column === sortColumn && 'text-app-text')}
        onClick={() => onSort(column)}>
        <span className={cn('flex min-w-0 items-center gap-1', FILE_LIST_COLUMN_ALIGN[column] === 'right' && 'justify-end')}>
          <span className="truncate">{FILE_LIST_COLUMN_LABELS[column]}</span>
          {column === sortColumn && (sortDirection === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
        </span>
      </button>
    </Tooltip>)}
  </div>;
}
