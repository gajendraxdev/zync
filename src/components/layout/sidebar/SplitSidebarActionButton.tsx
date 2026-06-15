import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../lib/utils';

export interface SplitSidebarActionButtonProps {
    icon: ReactNode;
    label: string;
    expanded: boolean;
    active?: boolean;
    onPrimaryClick: () => void;
    onToggleClick: () => void;
    toggleAriaLabel?: string;
}

export function SplitSidebarActionButton({
    icon,
    label,
    expanded,
    active = false,
    onPrimaryClick,
    onToggleClick,
    toggleAriaLabel = 'Toggle section menu',
}: SplitSidebarActionButtonProps) {
    const shellClassName = cn(
        'flex w-full overflow-hidden rounded-lg border border-transparent',
        'bg-app-surface/30',
        active && 'border-app-border/30 text-app-text',
    );

    const segmentClassName = cn(
        'group transition-all cursor-pointer select-none outline-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg',
        'text-app-muted hover:text-app-text hover:bg-app-surface',
    );

    return (
        <div className={shellClassName}>
            <button
                type="button"
                className={cn(
                    segmentClassName,
                    'flex flex-1 items-center py-2 px-3 min-w-0',
                    active && 'text-app-text',
                )}
                onClick={onPrimaryClick}
            >
                <span className="shrink-0 opacity-70 group-hover:opacity-100">{icon}</span>
                <span className="ml-3 truncate font-medium text-[10px] uppercase tracking-wider opacity-80 group-hover:opacity-100">
                    {label}
                </span>
            </button>
            <button
                type="button"
                aria-expanded={expanded}
                aria-label={toggleAriaLabel}
                className={cn(
                    segmentClassName,
                    'flex w-8 shrink-0 items-center justify-center border-l border-app-border/25',
                )}
                onClick={onToggleClick}
            >
                <ChevronRight
                    size={12}
                    className={cn(
                        'opacity-60 transition-transform duration-200 group-hover:opacity-100',
                        expanded && 'rotate-90',
                    )}
                />
            </button>
        </div>
    );
}