import { useRef } from 'react';
import { GripVertical } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import { parseWorkspaceNavigation, resolveWorkspaceNavigation } from '../../../features/workspace/domain/navigation';
import { navigationStripDropTarget } from '../../../features/workspace/domain/navigationStripPlacement';
import { useTabDragPointer } from '../tabDrag/useTabDragPointer';
import { createTabDragPreview } from '../tabDrag/preview';
import { IconButton } from '../../ui/IconButton';
import { Tooltip } from '../../ui/Tooltip';
import { CONTROL_INSET_FOCUS_CLASSES } from '../../ui/controlStyles';
import { useWorkspaceContextActions } from '../../workspace/workspaceActionsContext';

/** Separate gesture from pane reordering; only inert chrome moves until the save succeeds. */
export function WorkspaceStripHandle({ tabId }: { tabId: string }) {
    const raw = useAppStore(state => state.settings.workspaceNavigation);
    const ready = useAppStore(state => !state.isLoadingSettings && !state.isReloadingSettings);
    const disabled = !ready || !parseWorkspaceNavigation(raw);
    const position = resolveWorkspaceNavigation(raw).workspaceTabsPosition ?? 'default';
    const latest = useRef({ raw, disabled });
    latest.current = { raw, disabled };
    const actions = useWorkspaceContextActions();
    const drag = useTabDragPointer<null>((target, _payload, origin) => {
        const source = target.closest<HTMLElement>('[data-tab-drag-source]');
        const frame = source?.closest<HTMLElement>('[data-navigation-frame]');
        if (!source || !frame || disabled) return null;
        const valid = () => source.isConnected && frame.isConnected && latest.current.raw === raw
            && !latest.current.disabled && useAppStore.getState().activeTabId === tabId;
        let preview: ReturnType<typeof createTabDragPreview> = null;
        let guide: HTMLDivElement | null = null;
        const destination = (point: { x: number; y: number }) => navigationStripDropTarget(point, frame.getBoundingClientRect());
        return {
            isValid: valid,
            start: () => {
                preview = createTabDragPreview(source, origin);
                guide = document.createElement('div');
                guide.inert = true;
                guide.setAttribute('aria-hidden', 'true');
                guide.className = 'fixed pointer-events-none z-[10000] bg-app-accent/40 rounded-sm';
                guide.hidden = true;
                document.body.appendChild(guide);
            },
            move: point => {
                preview?.move(point);
                if (!guide) return;
                const value = destination(point);
                guide.hidden = !value || value === position;
                const bounds = frame.getBoundingClientRect();
                Object.assign(guide.style, { left: `${value === 'right' ? bounds.right - 4 : bounds.left}px`,
                    top: `${bounds.top}px`, width: `${value === 'default' ? bounds.width : 4}px`,
                    height: `${value === 'default' ? 4 : bounds.height}px` });
            },
            resolveDrop: point => {
                const value = destination(point);
                if (!value || value === position) return null;
                return () => {
                    if (!valid()) return false;
                    void useAppStore.getState().updateWorkspaceNavigation({ type: 'workspace-tabs', value })
                        .catch(() => useAppStore.getState().showToast('error', 'Could not move pane tabs. Please retry or reload settings.'));
                    return true;
                };
            },
            cancel: () => {},
            dispose: () => { preview?.dispose(); guide?.remove(); },
        };
    });
    return <div data-tab-drag-source className="shrink-0 flex items-center"
        onPointerDown={event => drag.begin(event, null)}
        onClickCapture={event => { if (drag.consumeClickIfDragged()) { event.preventDefault(); event.stopPropagation(); } }}>
        <Tooltip content="Move pane tabs — drag to an edge or choose a position">
            <IconButton data-workspace-tab-trigger data-workspace-strip-handle={tabId} label="Move pane tabs"
                disabled={disabled} icon={<GripVertical size={12} />} aria-haspopup="menu"
                className={`h-6 w-5 cursor-grab text-app-muted ${CONTROL_INSET_FOCUS_CLASSES}`}
                onClick={event => actions?.open(event)} onKeyDown={event => {
                    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) actions?.open(event);
                }} />
        </Tooltip>
        <div hidden aria-hidden="true"><div data-tab-drag-preview className="flex h-7 items-center justify-center rounded-md bg-app-panel text-app-muted"><GripVertical size={12} /></div></div>
    </div>;
}
