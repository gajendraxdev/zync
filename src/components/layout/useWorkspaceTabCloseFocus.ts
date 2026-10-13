import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

export interface WorkspaceTabCloseFocusIntent {
    tabId: string;
    origin: HTMLElement;
    neighborIds: string[];
}

interface PendingFocus extends WorkspaceTabCloseFocusIntent {
    closingDialog: HTMLElement | null;
}

/** Hand off from a contextual menu to the close owner with a persistent exact-tab
 * opener. No nested dialogs or timers: cancellation/guarded removal use normal focus recovery.
 */
export function requestWorkspaceTabCloseFromMenu(
    tabId: string,
    list: HTMLElement | null,
    dismiss: () => void,
    requestClose: (tabId: string) => void,
): boolean {
    const matches = [...(list?.querySelectorAll<HTMLElement>('[data-workspace-tab]') ?? [])]
        .filter(node => node.dataset.workspaceTab === tabId);
    if (matches.length !== 1) return false;
    const tab = matches[0];
    tab.focus({ preventScroll: true });
    if (tab.ownerDocument.activeElement !== tab) return false;
    dismiss();
    requestClose(tabId);
    return true;
}

/** Restore only focus lost by a user-requested tab removal, never a blocked close. */
export function useWorkspaceTabCloseFocus(
    tabs: readonly { id: string }[],
    listRef: RefObject<HTMLDivElement | null>,
    fallbackRef: RefObject<HTMLButtonElement | null>,
    confirmationOpen: boolean,
) {
    const tabsRef = useRef(tabs);
    useLayoutEffect(() => { tabsRef.current = tabs; }, [tabs]);
    const [pending, setPending] = useState<PendingFocus | null>(null);

    const captureCloseFocus = useCallback((tabId: string): WorkspaceTabCloseFocusIntent | null => {
        const origin = document.activeElement;
        const wrapper = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-workspace-tab-item]') ?? [])]
            .find(node => node.dataset.workspaceTabItem === tabId);
        if (!(origin instanceof HTMLElement) || !wrapper?.contains(origin)) return null;
        const current = tabsRef.current;
        const index = current.findIndex(tab => tab.id === tabId);
        if (index < 0) return null;
        return {
            tabId, origin,
            neighborIds: [...current.slice(index + 1), ...current.slice(0, index).reverse()].map(tab => tab.id),
        };
    }, [listRef]);

    // The owner calls this only after its guarded close action really removed the tab.
    const restoreCloseFocus = useCallback((intent: WorkspaceTabCloseFocusIntent | null) => {
        if (!intent) return;
        const active = document.activeElement;
        setPending({ ...intent, closingDialog: active instanceof HTMLElement ? active.closest('[data-zync-modal-surface]') : null });
    }, []);

    useEffect(() => {
        if (!pending || confirmationOpen || tabs.some(tab => tab.id === pending.tabId)) return;
        // Let Modal's closing commit restore its opener first. No timer or focus work
        // survives unmount, and a user who already moved elsewhere keeps that focus.
        const frame = window.requestAnimationFrame(() => {
            const active = document.activeElement;
            const lostFocus = !active || active === document.body || !active.isConnected
                || active === pending.origin || Boolean(pending.closingDialog?.contains(active));
            if (lostFocus) {
                const nodes = [...(listRef.current?.querySelectorAll<HTMLElement>('[data-workspace-tab]') ?? [])];
                const next = pending.neighborIds.map(id => nodes.find(node => node.dataset.workspaceTab === id)).find(Boolean)
                    ?? nodes[0] ?? fallbackRef.current;
                next?.focus();
            }
            setPending(null);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [confirmationOpen, fallbackRef, listRef, pending, tabs]);

    return { captureCloseFocus, restoreCloseFocus };
}
