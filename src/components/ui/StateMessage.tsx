import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '../../lib/utils.js';

export interface StateMessageProps extends Omit<HTMLAttributes<HTMLParagraphElement>, 'role' | 'aria-live'> {
  /** Empty content stays quiet; errors and results use their native live-region roles. */
  variant: 'empty' | 'error' | 'status';
}

/** Shared state text and announcement semantics, without owning feature behavior.
 * Callers retain adjacent actions, retry/persistence logic and any explicit focus
 * management through the forwarded paragraph ref. Nothing is focused automatically.
 */
export const StateMessage = forwardRef<HTMLParagraphElement, StateMessageProps>(({ variant, className, ...props }, ref) => (
  <p {...props} ref={ref} role={variant === 'empty' ? undefined : variant === 'error' ? 'alert' : 'status'}
    className={cn('min-w-0 break-words text-sm', variant === 'error' ? 'text-control-danger' : 'text-app-muted', className)} />
));
StateMessage.displayName = 'StateMessage';
