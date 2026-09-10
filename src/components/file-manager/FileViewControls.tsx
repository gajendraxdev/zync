import { Check, ChevronDown, Eye, LayoutGrid, LayoutList, Minus, Plus } from 'lucide-react';
import { memo, useCallback, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Tooltip } from '../ui/Tooltip';
import { TopbarDropdown } from '../ui/TopbarDropdown';
import { FILE_LIST_SORT_INITIAL, type FileSortColumn, type FileSortDirection } from './fileGridLayout';
import { useDismiss } from './useDismiss';

const SORT_COLUMNS: Array<{ label: string; column: FileSortColumn }> = [
  { label: 'Name', column: 'name' },
  { label: 'Date modified', column: 'modified' },
  { label: 'Size', column: 'size' },
];

function SegBtn({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} position="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
          active ? 'bg-app-surface text-app-text shadow-sm' : 'text-app-muted hover:text-app-text',
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function MenuRow({
  label,
  checked,
  disabled,
  icon,
  onClick,
}: {
  label: string;
  checked?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={checked}
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-app-text hover:bg-app-surface disabled:opacity-35"
    >
      {icon && <span className="w-3.5 shrink-0 text-app-muted">{icon}</span>}
      <span className="min-w-0 flex-1">{label}</span>
      <span className="w-3.5 shrink-0">
        {checked ? <Check size={13} className="text-app-accent" /> : null}
      </span>
    </button>
  );
}

export const FileViewControls = memo(function FileViewControls({
  viewMode,
  onToggleView,
  showHidden,
  onToggleHidden,
  onZoomIn,
  onZoomOut,
  canZoomIn,
  canZoomOut,
  sortColumn,
  sortDirection,
  onSort,
  menuSide = 'bottom',
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
  compact?: boolean;
  menuSide?: 'bottom' | 'top';
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, rootRef);
  const reversed = sortDirection !== FILE_LIST_SORT_INITIAL[sortColumn];

  return (
    <div ref={rootRef} className="relative flex items-center">
      <div className="inline-flex items-center rounded-md bg-app-bg/45 p-0.5" role="group" aria-label="Files view">
        <SegBtn label="Grid view" active={viewMode === 'grid'} onClick={() => onToggleView('grid')}>
          <LayoutGrid size={14} />
        </SegBtn>
        <SegBtn label="List view" active={viewMode === 'list'} onClick={() => onToggleView('list')}>
          <LayoutList size={14} />
        </SegBtn>
        <Tooltip content="View options" position="bottom">
          <button
            type="button"
            aria-label="View options"
            onClick={() => setOpen((value) => !value)}
            className={cn(
              'inline-flex h-7 w-6 items-center justify-center rounded-md text-app-muted hover:text-app-text',
              open && 'text-app-text',
            )}
          >
            <ChevronDown size={13} />
          </button>
        </Tooltip>
      </div>
      {open && (
        <TopbarDropdown align="right" side={menuSide} widthClass="w-52" className="z-50 p-1">
          {SORT_COLUMNS.map((item) => (
            <MenuRow
              key={item.column}
              label={item.label}
              checked={sortColumn === item.column}
              onClick={() => {
                onSort(item.column, FILE_LIST_SORT_INITIAL[item.column]);
                setOpen(false);
              }}
            />
          ))}
          <MenuRow
            label="Reverse order"
            checked={reversed}
            onClick={() => {
              onSort(sortColumn, reversed ? FILE_LIST_SORT_INITIAL[sortColumn] : (sortDirection === 'asc' ? 'desc' : 'asc'));
              setOpen(false);
            }}
          />
          <div className="mx-1 my-1 h-px bg-app-border/25" />
          <MenuRow
            label="Larger icons"
            icon={<Plus size={13} />}
            disabled={!canZoomIn}
            onClick={onZoomIn}
          />
          <MenuRow
            label="Smaller icons"
            icon={<Minus size={13} />}
            disabled={!canZoomOut}
            onClick={onZoomOut}
          />
          <div className="mx-1 my-1 h-px bg-app-border/25" />
          <MenuRow
            label="Show hidden files"
            icon={<Eye size={13} />}
            checked={showHidden}
            onClick={() => {
              onToggleHidden();
              setOpen(false);
            }}
          />
        </TopbarDropdown>
      )}
    </div>
  );
});
