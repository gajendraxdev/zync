import { fileNameParts } from './fileListPresentation';
import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** One full accessible name; visual truncation preserves its short extension. */
export const FileName = forwardRef<HTMLSpanElement, { name: string } & HTMLAttributes<HTMLSpanElement>>(function FileName({ name, className, ...props }, ref) {
  const { base, extension } = fileNameParts(name);
  return <span {...props} ref={ref} className={cn('flex min-w-0 text-sm text-app-text', className)} aria-label={name}>
    <span className="min-w-0 truncate">{base}</span>
    {extension && <span className="shrink-0">{extension}</span>}
  </span>;
});
