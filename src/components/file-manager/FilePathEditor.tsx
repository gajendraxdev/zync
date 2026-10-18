import { ChevronRight, Loader2, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { TopbarDropdown } from '../ui/TopbarDropdown';
import { FileEntryIcon } from './FileEntryIcon';
import type { FileFolderLoader, FileFolderOption } from './fileFolderOptions';
import { completeFileFolderPath } from './filePathCompletion';
import { useFilePathSuggestions } from './useFilePathSuggestions';

export type FilePathRestoreFocus = 'current' | 'edit' | null;

/** Editable path combobox: click/Tab completes without navigation; Enter validates and opens. */
export function FilePathEditor({ currentPath, homePath, connectionId, loadFolders, toolbarRef, onNavigate, onClose, disabled }: {
  currentPath: string;
  homePath?: string;
  connectionId?: string | null;
  loadFolders: FileFolderLoader;
  toolbarRef: RefObject<HTMLDivElement | null>;
  onNavigate: (path: string) => void;
  onClose: (focus: FilePathRestoreFocus) => void;
  disabled?: boolean;
}) {
  const checkPathExists = useAppStore(state => state.checkPathExists);
  const [value, setValue] = useState(currentPath);
  const [invalid, setInvalid] = useState(false);
  const [focused, setFocused] = useState(false);
  const [requested, setRequested] = useState(false);
  const [composing, setComposing] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const scope = useId();
  const listId = `files-path-suggestions-${scope}`;
  const hintId = `files-path-hint-${scope}`;
  const suggestions = useFilePathSuggestions(value, currentPath, homePath, loadFolders, focused && requested && !composing && !disabled);
  const expanded = focused && requested && !composing && suggestions.query !== null && !disabled;
  const active = expanded && activeIndex >= 0 ? suggestions.options[Math.min(activeIndex, suggestions.options.length - 1)] : undefined;
  const optionId = (index: number) => `${listId}-${index}`;
  const activeId = active ? optionId(Math.min(activeIndex, suggestions.options.length - 1)) : undefined;

  useLayoutEffect(() => {
    generation.current += 1;
    setValue(currentPath);
    setInvalid(false);
    setRequested(false);
    setActiveIndex(-1);
    return () => { generation.current += 1; };
  }, [currentPath, connectionId]);
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: 'nearest' });
  }, [activeId]);

  const change = (next: string) => {
    generation.current += 1;
    setValue(next);
    setInvalid(false);
    setRequested(true);
    setActiveIndex(-1);
  };
  const close = (restore: FilePathRestoreFocus) => {
    generation.current += 1;
    setRequested(false);
    onClose(restore);
  };
  const submit = async (path: string, source: 'enter' | 'blur') => {
    if (disabled) return;
    const request = ++generation.current;
    if (!path) { close(source === 'enter' ? 'current' : null); return; }
    setRequested(false);
    if (source === 'enter') { setValue(path); setActiveIndex(-1); }
    if (path !== currentPath && connectionId) {
      const exists = await checkPathExists(connectionId, path);
      if (request !== generation.current) return;
      if (!exists) {
        setInvalid(true);
        if (source === 'enter') input.current?.focus({ preventScroll: true });
        return;
      }
    }
    if (request !== generation.current) return;
    onNavigate(path);
    close(source === 'enter' ? 'edit' : null);
  };
  const complete = (folder: FileFolderOption) => {
    if (!suggestions.query) return;
    change(completeFileFolderPath(folder.path, suggestions.query.separator));
    input.current?.focus({ preventScroll: true });
  };

  return <div className="flex h-full min-w-0 flex-1 items-center rounded-md border border-control-focus bg-app-bg/45">
    <input ref={input} autoFocus role="combobox" aria-label="Path" autoComplete="off" spellCheck={false}
      aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={activeId} aria-describedby={hintId} aria-invalid={invalid}
      className={cn('h-full min-w-0 flex-1 bg-transparent px-2.5 text-[0.8125rem] outline-none', invalid ? 'text-app-danger' : 'text-app-text')}
      value={value} onFocus={() => setFocused(true)} onChange={event => change(event.target.value)}
      onCompositionStart={() => { generation.current += 1; setComposing(true); setActiveIndex(-1); }} onCompositionEnd={() => setComposing(false)}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || composing) return;
        if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault();
          generation.current += 1;
          setRequested(true);
          if (suggestions.status === 'error') suggestions.retry();
          const count = suggestions.options.length;
          setActiveIndex(previous => count === 0 ? 0 : event.key === 'ArrowDown'
            ? (previous + 1) % count : previous <= 0 ? count - 1 : previous - 1);
        } else if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && active) {
          event.preventDefault();
          complete(active);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          void submit(active?.path ?? input.current?.value ?? value, 'enter');
        } else if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation();
          if (expanded) { setRequested(false); setActiveIndex(-1); }
          else close('current');
        }
      }}
      onBlur={event => {
        setFocused(false);
        setRequested(false);
        const next = event.relatedTarget as Node | null;
        if (next === cancel.current) return;
        if (next && toolbarRef.current?.contains(next)) { close(null); return; }
        void submit(event.currentTarget.value, 'blur');
      }} />
    <span id={hintId} className="sr-only">Type a path or add its separator for child folders. Arrow keys select. Tab completes a selected folder. Enter opens. Escape dismisses suggestions, then cancels editing.</span>
    {invalid && <span role="alert" className="sr-only">Path not found or unavailable.</span>}
    <Tooltip content="Cancel path edit" position="bottom">
      <IconButton ref={cancel} label="Cancel path edit" icon={<X size={13} />} className="mr-0.5 shrink-0"
        onPointerDown={event => event.preventDefault()} onClick={() => close('current')} />
    </Tooltip>
    {expanded && input.current && <TopbarDropdown anchor={input.current} widthClass="w-[min(32rem,calc(100vw-1rem))]" className="files-path-completions">
      <div className="truncate px-2 py-1.5 text-xs text-app-muted" title={suggestions.query?.parent}>Folders in {suggestions.query?.parent}</div>
      <div id={listId} role="listbox" aria-label="Folder suggestions" aria-busy={suggestions.status === 'loading'} className="max-h-[min(16rem,45vh)] overflow-y-auto overscroll-contain">
        {suggestions.options.map((folder, index) => <div key={folder.path} id={optionId(index)} role="option" aria-label={folder.name} aria-selected={folder === active}
          className={cn('flex min-h-8 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-app-text hover:bg-app-surface', folder === active && 'bg-app-surface ring-1 ring-inset ring-control-focus')}
          onPointerDown={event => event.preventDefault()} onClick={event => { event.stopPropagation(); complete(folder); }}>
          <FileEntryIcon file={{ name: folder.name, type: 'd' }} size={18} />
          <span className="min-w-0 flex-1 break-all">{folder.name}</span><ChevronRight size={12} aria-hidden="true" className="shrink-0 text-app-muted" />
        </div>)}
      </div>
      {suggestions.status === 'loading' ? <div role="status" className="flex items-center gap-2 px-2 py-2 text-xs text-app-muted"><Loader2 size={12} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />Loading folders…</div>
        : suggestions.status === 'error' ? <div role="status" className="px-2 py-2 text-xs text-app-muted">Unable to load folders. Press ↓ to retry, or enter a path.</div>
          : suggestions.total === 0 && <div role="status" className="px-2 py-2 text-xs text-app-muted">No matching folders. You can still enter a path.</div>}
      <div className="border-t border-app-border/50 px-2 py-1.5 text-xs text-app-muted">
        {suggestions.total > suggestions.options.length && <span className="block pb-1">Showing {suggestions.options.length} of {suggestions.total} folders. Type more to narrow.</span>}
        ↑↓ select · Click/Tab complete · Enter open
      </div>
    </TopbarDropdown>}
  </div>;
}
