import type { Tab } from '../connections/domain/types';
import { deriveWorkspaceContentInventory } from '../workspace/domain/contentInventory';
import { hiddenContentIds } from '../workspace/domain/contentPresentation';
import type { WorkspaceContentState } from '../workspace/domain/visibleContent';
import type { WorkspacePresentationAction } from './types';

export const WORKSPACE_PRESENTATION_EVENT = 'zync:workspace-presentation';

/** Minimal read boundary; presentation commands never own resources or persistence. */
export interface WorkspaceCommandState extends Pick<WorkspaceContentState, 'terminals' | 'paneLayouts' | 'contentPresentation'> {
    tabs: readonly Pick<Tab, 'id' | 'type' | 'connectionId'>[];
    activeTabId: string | null;
    sessionLoaded: boolean;
    isRestoring: boolean;
    sessionPersistenceBlocked: boolean;
}

export interface WorkspacePresentationTarget {
    action: WorkspacePresentationAction;
    tabId: string;
    connectionId?: string;
}

/** One availability policy for visible palette entries and fresh command execution. */
export function workspacePresentationTarget(action: WorkspacePresentationAction,
    state: WorkspaceCommandState): WorkspacePresentationTarget | null {
    // Reject retired/unknown runtime requests as well as typed callers.
    if (action !== 'customize-tab' && action !== 'contents' && action !== 'reveal-all' && action !== 'maximize-pane') return null;
    if (!state.sessionLoaded || state.isRestoring) return null;
    const tab = state.tabs.find(item => item.id === state.activeTabId);
    if (!tab) return null;
    if (action === 'customize-tab') return { action, tabId: tab.id };
    if (tab.type !== 'connection' || !tab.connectionId) return null;
    if (action === 'reveal-all') {
        const inventory = deriveWorkspaceContentInventory(state.terminals[tab.connectionId] ?? [], state.paneLayouts[tab.connectionId]);
        if (state.sessionPersistenceBlocked || hiddenContentIds(inventory, state.contentPresentation?.[tab.connectionId]).size === 0) return null;
    }
    return { action, tabId: tab.id, connectionId: tab.connectionId };
}

/** Dispatch only a validated, addressed host action; retained inactive workspaces ignore it. */
export function dispatchWorkspacePresentationAction(action: WorkspacePresentationAction, state: WorkspaceCommandState): boolean {
    const target = workspacePresentationTarget(action, state);
    if (!target) return false;
    window.dispatchEvent(new CustomEvent(WORKSPACE_PRESENTATION_EVENT, { detail: target }));
    return true;
}

/**
 * Revalidate at delivery so deferred palette work cannot target a closed/inactive
 * tab. This host-only event is deliberately absent from the iframe shortcut bridge.
 */
export function listenWorkspacePresentationActions(getState: () => WorkspaceCommandState,
    accepts: (target: WorkspacePresentationTarget) => boolean,
    run: (target: WorkspacePresentationTarget) => void): () => void {
    const listener = (event: Event) => {
        const detail: unknown = (event as CustomEvent<unknown>).detail;
        if (!detail || typeof detail !== 'object') return;
        const request = detail as Partial<WorkspacePresentationTarget>;
        if (request.action !== 'customize-tab' && request.action !== 'contents' && request.action !== 'reveal-all'
            && request.action !== 'maximize-pane') return;
        const target = workspacePresentationTarget(request.action, getState());
        if (!target || target.tabId !== request.tabId || target.connectionId !== request.connectionId || !accepts(target)) return;
        run(target);
    };
    window.addEventListener(WORKSPACE_PRESENTATION_EVENT, listener);
    return () => window.removeEventListener(WORKSPACE_PRESENTATION_EVENT, listener);
}
