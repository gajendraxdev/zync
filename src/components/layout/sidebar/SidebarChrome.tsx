import { createContext, useContext, useMemo, type ReactNode, type RefObject } from 'react';
import { cn } from '../../../lib/utils';
import { DEFAULT_SIDEBAR_WIDTH_LIMITS, useSidebarResize, type SidebarWidthLimits } from './useSidebarResize';
import { CONTROL_INSET_FOCUS_CLASSES } from '../../ui/controlStyles';
import { SIDEBAR_WIDTH_TRANSITION_CLASSES } from '../../ui/sidebarStyles';
import { useLayoutWidthTransition } from '../../ui/LayoutMotion';

function notifyLayoutTransition(moving: boolean) {
    window.dispatchEvent(new CustomEvent(`zync:layout-transition-${moving ? 'start' : 'end'}`));
}

const SidebarContentContext = createContext<{ width: number; contentRef: RefObject<HTMLDivElement | null> } | null>(null);

/** One stable content wrapper per shell; live sizing never inherits into its children. */
export function SidebarContent({ children, className, inert }: { children: ReactNode; className?: string; inert?: boolean }) {
    const sizing = useContext(SidebarContentContext);
    if (!sizing) throw new Error('SidebarContent must be inside SidebarChrome');
    return <div ref={sizing.contentRef} data-sidebar-content inert={inert} className={className}
        style={{ width: sizing.width, minWidth: sizing.width }}>{children}</div>;
}

/** Shared shell for primary navigation and secondary tools; content and persistence stay caller-owned. */
export function SidebarChrome({ children, position, collapsed, savedWidth, onResize, className,
    widthLimits = DEFAULT_SIDEBAR_WIDTH_LIMITS, resizeLabel = 'Resize sidebar', order, landmarkLabel }: {
    children: ReactNode; position: 'left' | 'right'; collapsed: boolean;
    savedWidth: number; onResize: (width: number) => void; className?: string;
    widthLimits?: SidebarWidthLimits; resizeLabel?: string; order?: number; landmarkLabel?: string;
}) {
    const { width, isResizing, sidebarRef, contentRef, handlers } = useSidebarResize(savedWidth, onResize, position, widthLimits, !collapsed);
    useLayoutWidthTransition(sidebarRef, { enabled: !isResizing, onMovingChange: notifyLayoutTransition });
    const contentSizing = useMemo(() => ({ width, contentRef }), [width, contentRef]);
    return <div ref={sidebarRef} data-shared-sidebar data-sidebar-position={position} data-zync-color="sidebar"
        role={landmarkLabel ? 'complementary' : undefined} aria-label={landmarkLabel} inert={collapsed}
        className={cn('bg-app-panel flex flex-col h-full min-h-0 shrink-0 relative z-50 overflow-hidden',
            !collapsed && (position === 'right' ? 'border-l border-app-border/50' : 'border-r border-app-border/50'),
            !isResizing && SIDEBAR_WIDTH_TRANSITION_CLASSES, className)}
        style={{ width: collapsed ? 0 : width, order: order ?? (position === 'right' ? 1 : 0),
            willChange: isResizing ? 'auto' : 'width' }}>
        {!collapsed && <div {...handlers} role="separator" aria-label={resizeLabel} aria-orientation="vertical"
            aria-valuemin={widthLimits.minWidth} aria-valuemax={widthLimits.maxWidth} aria-valuenow={width} tabIndex={0}
            className={cn('absolute top-0 bottom-0 w-1 hover:w-1.5 cursor-col-resize hover:bg-app-accent/50 transition-colors z-[100]',
                CONTROL_INSET_FOCUS_CLASSES,
                position === 'right' ? 'left-0' : 'right-0')} style={{ touchAction: 'none' }} />}
        <SidebarContentContext.Provider value={contentSizing}>{children}</SidebarContentContext.Provider>
    </div>;
}
