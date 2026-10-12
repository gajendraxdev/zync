import type { Tab } from '../../connections/domain/types';
import { GLOBAL_SNIPPETS_CONNECTION_ID } from '../../connections/application/tabService';

/** Resolve an existing host, including Local Terminal; never create or connect one. */
export function selectHostWorkspaceTab(tabs: readonly Tab[], activeId: string | null,
    activeConnection: string | null, lastConnection?: string | null): Tab | undefined {
    const candidates = tabs.filter(tab => tab.type === 'connection' && tab.connectionId
        && tab.connectionId !== GLOBAL_SNIPPETS_CONNECTION_ID);
    return candidates.find(tab => tab.id === activeId)
        ?? candidates.find(tab => tab.connectionId === activeConnection)
        ?? candidates.find(tab => tab.connectionId === lastConnection)
        ?? candidates[0];
}
