import { Filter, Search, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { FileActionMenu } from './FileActionMenu';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import type { FileSearchTypeFilter } from './fileSearchFilter';

export type { FileSearchTypeFilter };

const TYPE_FILTERS: Array<{ id: FileSearchTypeFilter; label: string }> = [
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
  const hintId = useId();
  const hasFilter = value.length > 0 || typeFilter !== 'all';
  const typeLabel = TYPE_FILTERS.find(option => option.id === typeFilter)?.label ?? 'All types';

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="files-query-editor flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-md bg-app-bg/45 px-2"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}>
      <Search size={13} className="shrink-0 text-app-muted" />
      <input
        ref={inputRef}
        aria-label="Search this folder"
        aria-describedby={hintId}
        data-file-filter-input=""
        className="h-full min-w-0 flex-1 bg-transparent text-[12px] text-app-text outline-none placeholder:text-app-muted/50"
        placeholder="Search this folder…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span id={hintId} className="sr-only">Filters filenames in this folder only, not file contents.</span>
      <FileActionMenu label="Filter file types" text={typeLabel} tooltip={`Filter file types · ${typeLabel}`} keepLabel
        icon={<Filter size={13} />} items={[{ label: 'All types', checked: typeFilter === 'all', action: () => onTypeFilter('all') }, ...TYPE_FILTERS.map(chip => ({
          label: chip.label, checked: typeFilter === chip.id,
          action: () => onTypeFilter(typeFilter === chip.id ? 'all' : chip.id),
        }))]} />
      <Tooltip content={hasFilter ? 'Clear filters' : 'Close search'} position="bottom">
        <IconButton label={hasFilter ? 'Clear filters' : 'Close search'} icon={<X size={13} />} onClick={() => {
          if (!hasFilter) { onClose(); return; }
          onChange('');
          onTypeFilter('all');
          inputRef.current?.focus({ preventScroll: true });
        }} />
      </Tooltip>
    </div>
  );
}
