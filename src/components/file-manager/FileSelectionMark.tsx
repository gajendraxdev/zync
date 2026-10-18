import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Visual toggle target; its owning listbox option supplies selection semantics and keyboard access. */
export function FileSelectionMark({ selected, className }: { selected: boolean; className?: string }) {
  return <span data-file-select="" aria-hidden="true" className={cn('files-selection-mark inline-flex h-6 w-6 shrink-0 items-center justify-center', className)}>
    <span className="files-selection-box inline-flex h-4 w-4 items-center justify-center rounded-[4px] border">
      {selected && <Check size={12} strokeWidth={2.5} />}
    </span>
  </span>;
}

/** Checkbox-style pointer toggles do not replace selection or open a file on double click. */
export function isFileSelectionMark(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('[data-file-select]'));
}
