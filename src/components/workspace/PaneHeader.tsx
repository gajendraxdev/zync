import type { PointerEvent, MouseEvent, KeyboardEvent, ReactNode } from 'react';
import { Maximize2, Minimize2, PanelsTopLeft, X } from 'lucide-react';
import { IconButton } from '../ui/IconButton';
import { TabDragPreview } from '../layout/TabDragPreview';
import { Tooltip } from '../ui/Tooltip';
import { DockIndicator } from './DockIndicator';
import type { DockedPaneRegion } from '../../features/workspace/domain/docking';
import { DOCK_REGION_LABELS } from '../../features/workspace/domain/dockPresentation';
import { cn } from '../../lib/utils';

export interface PaneHeaderProps {
    label: string;
    /** Canonical title remains available when a user sets a display alias. */
    defaultTitle: string;
    icon: ReactNode;
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onRename: () => void;
    onClose: () => void;
    onOpenContextMenu?: (event: MouseEvent<HTMLDivElement> | KeyboardEvent<HTMLDivElement>) => void;
    maximized?: boolean;
    onToggleMaximize?: () => void;
    dockRegion?: DockedPaneRegion;
    dockFocused?: boolean;
    onReturnToTabs?: () => void;
    returnToTabsDisabled?: boolean;
}

/** Shared pane chrome; content lifecycle and presentation updates belong to callers. */
export function PaneHeader({ label, defaultTitle, icon, onPointerDown, onRename, onClose, onOpenContextMenu, maximized = false, onToggleMaximize,
    dockRegion, dockFocused = false, onReturnToTabs, returnToTabsDisabled }: PaneHeaderProps) {
    const dockLabel = dockRegion ? `Docked ${DOCK_REGION_LABELS[dockRegion]}` : undefined;
    return (
        <div
            role="group"
            tabIndex={0}
            data-zync-color="paneHeader"
            data-tab-drag-source
            aria-label={`${label} pane controls${dockLabel ? ` — ${dockLabel}${dockFocused ? ', focused dock' : ''}` : ''}`}
            data-pane-dock={dockRegion}
            data-dock-focused={dockRegion ? dockFocused : undefined}
            className={cn('relative h-7 shrink-0 flex items-center gap-1.5 px-2 border-b border-app-border/60 bg-app-panel cursor-grab active:cursor-grabbing select-none',
                dockRegion && dockFocused && 'after:absolute after:left-0 after:inset-y-1 after:w-0.5 after:rounded after:bg-app-accent after:pointer-events-none')}
            onPointerDown={onPointerDown}
            onContextMenu={onOpenContextMenu}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
                    if (!onOpenContextMenu) return;
                    event.preventDefault();
                    onOpenContextMenu(event); return;
                }
                if (event.key !== 'F2' || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                event.stopPropagation();
                onRename();
            }}
        >
            <div hidden aria-hidden="true"><TabDragPreview icon={icon}>{label}</TabDragPreview></div>
            <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span>
            <Tooltip content={`${label === defaultTitle ? defaultTitle : `${label} — ${defaultTitle}`}${dockLabel ? ` — ${dockLabel}. Stays visible across tabs.` : ''}`}>
                <span data-zync-color-label className="flex-1 min-w-0 truncate text-[11px] font-medium text-app-text">{label}</span>
            </Tooltip>
            {dockRegion && <DockIndicator regions={[dockRegion]} focused={dockFocused} />}
            {dockRegion && onReturnToTabs && <Tooltip content="Return to tabs — keep this pane and its content" disabledTrigger={returnToTabsDisabled}>
                <IconButton
                    label={`Return ${label} to tabs`}
                    icon={<PanelsTopLeft size={12} />}
                    disabled={returnToTabsDisabled}
                    className="h-5 w-5"
                    onPointerDown={event => event.stopPropagation()}
                    onClick={event => { event.stopPropagation(); onReturnToTabs(); }}
                />
            </Tooltip>}
            {onToggleMaximize && <Tooltip content={maximized ? 'Restore pane — return to the saved arrangement' : 'Maximize pane — temporarily fill the workspace'}>
                <IconButton
                    label={maximized ? `Restore ${label} pane` : `Maximize ${label} pane`}
                    icon={maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                    className="h-5 w-5"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); onToggleMaximize(); }}
                />
            </Tooltip>}
            <Tooltip content={`Close ${label} pane`}>
                <IconButton
                    label={`Close ${label} pane`}
                    icon={<X size={12} />}
                    className="h-5 w-5 hover:text-red-400"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => { event.stopPropagation(); onClose(); }}
                />
            </Tooltip>
        </div>
    );
}
