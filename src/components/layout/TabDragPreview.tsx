import type { ReactNode } from 'react';

/** Compact pane chrome shares row geometry with its inert drag preview. */
export const COMPACT_TAB_ROW_CLASSES = 'flex items-center gap-1.5 px-2 h-7 text-xs font-medium';
export const COMPACT_TAB_LABEL_CLASSES = 'truncate min-w-0 flex-1 leading-4';

/** Shared, inert drag chrome for host tabs and panes; never renders resource content. */
export function TabDragPreview({ icon, children, decoration, compact = false }: {
    icon: ReactNode;
    children: ReactNode;
    decoration?: ReactNode;
    compact?: boolean;
}) {
    return <div aria-hidden="true" data-tab-drag-preview
        className={`relative rounded-md bg-app-surface text-app-text shadow-lg border border-app-border/50 ${compact
            ? COMPACT_TAB_ROW_CLASSES
            : 'flex items-center gap-2 px-2.5 py-1.5 h-8 text-sm font-medium'}`}>
        {icon}
        <span data-tab-label className={compact ? `${COMPACT_TAB_LABEL_CLASSES} max-w-[140px]` : 'truncate min-w-0 max-w-[140px]'}>{children}</span>
        {decoration}
    </div>;
}
