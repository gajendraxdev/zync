import { createContext, useContext, type KeyboardEvent, type MouseEvent } from 'react';
import type { ContextMenuItem } from '../ui/ContextMenu';

export interface WorkspaceActions {
    open: (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, ids?: readonly string[], extra?: ContextMenuItem[]) => void;
    rename: (id: string) => void;
    canReturnToTabs?: (id: string) => boolean;
    returnToTabs?: (id: string) => void;
}
export const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);
export const useWorkspaceContextActions = () => useContext(WorkspaceActionsContext);
