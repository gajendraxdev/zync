import { useRef } from 'react';
import type { Tab } from '../../../features/connections/domain/types';
import { isMainTabPinned } from '../../../features/workspace/domain/mainTabPresentation';
import { useTabDragPointer } from './useTabDragPointer';
import { createTabDragPreview } from './preview';
import { createTabReorderFeedback, reorderIndex, scrollTabStrip, tabReorderTarget } from './reorder';

interface WorkspaceTabDragOptions {
    tabs: readonly Tab[];
    activeTabId: string | null;
    getStrip: () => HTMLElement | null;
    canDrag?: () => boolean;
    /** Uses the existing stable-ID action, including readiness/pin/persistence guards. */
    onReorder?: (sourceId: string, targetId: string) => boolean | void;
}

const orderKey = (tabs: readonly Tab[]) => JSON.stringify(tabs.map(tab => [tab.id, isMainTabPinned(tab)]));

/** Host adapter: no activation or resource lifetime change is allowed during a drag. */
export function useWorkspaceTabDrag(options: WorkspaceTabDragOptions) {
    const latest = useRef(options);
    latest.current = options;
    return useTabDragPointer<string>((target, id, origin) => {
        const value = latest.current;
        if (!value.onReorder || value.canDrag?.() === false) return null;
        const source = target.closest<HTMLElement>('[data-workspace-tab-item]');
        const strip = value.getStrip();
        if (!source || source.dataset.workspaceTabItem !== id || source.closest('[data-tab-drag-strip]') !== strip) return null;
        const signature = orderKey(value.tabs);
        const activeTabId = value.activeTabId;
        let preview: ReturnType<typeof createTabDragPreview> = null;
        let sorting: ReturnType<typeof createTabReorderFeedback> = null;
        const valid = () => source.isConnected && source.dataset.workspaceTabItem === id
            && source.closest('[data-tab-drag-strip]') === strip && latest.current.getStrip() === strip
            && latest.current.activeTabId === activeTabId && latest.current.canDrag?.() !== false
            && orderKey(latest.current.tabs) === signature && !!latest.current.onReorder;
        return {
            isValid: valid,
            start: () => { preview = createTabDragPreview(source, origin); sorting = createTabReorderFeedback(source); },
            move: point => {
                const scrolling = scrollTabStrip(source, point);
                sorting?.update(tabReorderTarget(source, point, 'reorder'));
                preview?.move(point);
                return scrolling;
            },
            resolveDrop: point => {
                const target = tabReorderTarget(source, point, 'reorder');
                const from = value.tabs.findIndex(tab => tab.id === id);
                const to = value.tabs.findIndex(tab => tab.id === target?.element.dataset.workspaceTabItem);
                if (!target || from < 0 || to < 0) return null;
                const index = reorderIndex(from, to, target.after);
                const destination = value.tabs[index];
                if (!destination) return null;
                return () => valid() && (index === from || latest.current.onReorder?.(id, destination.id) !== false);
            },
            cancel: () => {},
            dispose: () => { preview?.dispose(); sorting?.dispose(); },
        };
    });
}
