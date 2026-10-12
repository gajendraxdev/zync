import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';
import { cn } from '../../lib/utils';

interface TabAddButtonProps extends Omit<ComponentPropsWithoutRef<typeof Button>,
    'children' | 'variant' | 'size' | 'aria-label' | 'aria-haspopup' | 'aria-expanded'> {
    label: string;
    open: boolean;
}

/** Shared tab-strip add chrome; callers retain menu placement, actions and focus ownership. */
export const TabAddButton = forwardRef<HTMLButtonElement, TabAddButtonProps>(({ label, open, className, type = 'button', ...props }, ref) => (
    <Tooltip content={label} position="bottom" disabled={open}>
        <Button {...props} ref={ref} type={type} variant="ghost" size="icon"
            aria-label={label} aria-haspopup="dialog" aria-expanded={open}
            className={cn(
                'h-7 w-7 shrink-0 rounded-md drag-none focus-visible:ring-2 focus-visible:ring-app-accent/60 focus-visible:ring-offset-0',
                open ? 'bg-app-accent/20 text-app-text' : 'text-app-muted hover:bg-app-surface hover:text-app-text',
                className,
            )}>
            <Plus aria-hidden="true" className="h-4 w-4" />
        </Button>
    </Tooltip>
));
TabAddButton.displayName = 'TabAddButton';
