import { Filter, Search, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { TopbarDropdown } from '../ui/TopbarDropdown';
import type { FileSearchTypeFilter } from './fileSearchFilter';
import { useDismiss } from './useDismiss';

export type { FileSearchTypeFilter };

const TYPE_CHIPS: Array<{ id: FileSearchTypeFilter; label: string }> = [
  { id: 'folders', label: 'Folders' },
  { id: 'documents', label: 'Documents' },
  { id: 'images', label: 'Images' },
  { id: 'text', label: 'Text' },
  { id: 'pdf', label: 'PDF' },
  { id: 'videos', label: 'Videos' },
  { id: 'audio', label: 'Audio' },
];

export function FileQueryEditor({
  value,
  onChange,
  onClose,
  typeFilter,
  onTypeFilter,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  typeFilter: FileSearchTypeFilter;
  onTypeFilter: (value: FileSearchTypeFilter) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  useDismiss(filtersOpen, closeFilters, filterRef);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md bg-app-bg/45 px-2 animate-in fade-in duration-150">
      <Search size={13} className="shrink-0 text-app-muted" />
      <input
        ref={inputRef}
        aria-label="Search this folder"
        className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-app-text outline-none placeholder:text-app-muted/50"
        placeholder="Search this folder…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      />
      <div className="relative" ref={filterRef}>
        <button
          type="button"
          aria-label="Filter results"
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-md text-app-muted hover:bg-app-surface/70 hover:text-app-text',
            filtersOpen && 'bg-app-surface text-app-text',
          )}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <Filter size={13} />
        </button>
        {filtersOpen && (
          <TopbarDropdown align="right" widthClass="w-72" className="z-50 p-3">
            <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-app-muted">File types</div>
            <div className="flex flex-wrap gap-1.5">
              {TYPE_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  aria-pressed={typeFilter === chip.id}
                  className={cn(
                    'rounded-md px-2.5 py-1 text-[11px] font-medium',
                    typeFilter === chip.id
                      ? 'bg-app-surface text-app-text shadow-sm'
                      : 'text-app-muted hover:bg-app-surface/50 hover:text-app-text',
                  )}
                  onClick={() => onTypeFilter(typeFilter === chip.id ? 'all' : chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-app-muted">
              Matches names in this folder. Content search is not enabled yet.
            </p>
          </TopbarDropdown>
        )}
      </div>
      <button
        type="button"
        aria-label="Close search"
        className="flex h-6 w-6 items-center justify-center rounded-md text-app-muted hover:bg-app-surface/70 hover:text-app-text"
        onClick={() => {
          onChange('');
          onClose();
        }}
      >
        <X size={13} />
      </button>
    </div>
  );
}
