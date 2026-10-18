import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../ui/Button';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/utils';

/** Files chrome adapter: the shared menu owns keyboard navigation and viewport placement. */
export function FileActionMenu({
  label, icon, items, disabled, iconOnly = false, tooltip = label, text = label, keepLabel = false,
  triggerClassName, menuClassName, errorLabel = 'Unable to load menu items',
}: {
  label: string;
  icon: ReactNode;
  items: ContextMenuItem[] | (() => Promise<ContextMenuItem[]>);
  disabled?: boolean;
  iconOnly?: boolean;
  tooltip?: string;
  text?: string;
  keepLabel?: boolean;
  triggerClassName?: string;
  menuClassName?: string;
  errorLabel?: string;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [loadedItems, setLoadedItems] = useState<ContextMenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const close = useCallback(() => {
    generation.current += 1;
    pending.current = false;
    // Return from the menu, but never take focus from a dialog opened by an action.
    if (trigger.current?.getAttribute('aria-expanded') === 'true' && document.activeElement?.closest('[role="menu"]')) {
      trigger.current.focus({ preventScroll: true });
    }
    setPosition(null);
    setLoading(false);
  }, []);
  const supplier = typeof items === 'function' ? items : undefined;
  const supplierRef = useRef(supplier);
  useLayoutEffect(() => {
    // A changed connection/path/filter or an unmount invalidates any deferred reply.
    supplierRef.current = supplier;
    close();
    return () => { generation.current += 1; pending.current = false; };
  }, [supplier, close]);
  useEffect(() => {
    if (!position && !loading) return;
    window.addEventListener('resize', close);
    return () => window.removeEventListener('resize', close);
  }, [position, loading, close]);
  const open = async () => {
    const bounds = trigger.current?.getBoundingClientRect();
    if (!bounds || disabled || pending.current || supplier !== supplierRef.current) return;
    if (!supplier) { setPosition({ x: bounds.left, y: bounds.bottom + 4 }); return; }
    const request = ++generation.current;
    pending.current = true;
    setLoading(true);
    trigger.current?.focus({ preventScroll: true });
    let nextItems: ContextMenuItem[];
    try { nextItems = await supplier(); }
    catch {
      nextItems = [
        { label: errorLabel, disabled: true, action: () => {} },
        { label: 'Retry', action: () => queueMicrotask(() => { void open(); }) },
      ];
    }
    if (request !== generation.current) return;
    pending.current = false;
    setLoading(false);
    const latest = trigger.current?.getBoundingClientRect();
    if (!latest) return;
    setLoadedItems(nextItems);
    setPosition({ x: latest.left, y: latest.bottom + 4 });
  };

  return <>
    <Tooltip content={tooltip} position="bottom">
      <Button ref={trigger} type="button" size="sm" variant="ghost" disabled={disabled}
        aria-label={label} aria-haspopup="menu" aria-expanded={position !== null}
        aria-busy={loading || undefined}
        className={cn('files-action-trigger h-7 shrink-0 gap-1.5 px-2', triggerClassName)}
        onBlur={() => { if (pending.current) close(); }}
        onClick={() => position || pending.current ? close() : void open()}
        onKeyDown={event => {
          if (event.key === 'ArrowDown') { event.preventDefault(); if (!position) void open(); }
          if (event.key === 'Escape' && pending.current) { event.preventDefault(); event.stopPropagation(); close(); }
        }}>
        <span aria-hidden="true" className="inline-flex shrink-0">{loading ? <Loader2 size={12} className="animate-spin motion-reduce:animate-none" /> : icon}</span>
        {!iconOnly && <span className={keepLabel ? 'truncate' : 'files-action-label'}>{text}</span>}
      </Button>
    </Tooltip>
    {loading && <span role="status" className="sr-only">Loading…</span>}
    {position && <ContextMenu {...position} items={typeof items === 'function' ? loadedItems : items} className={menuClassName} ariaLabel={label} autoFocus triggerRef={trigger} onClose={close} />}
  </>;
}
