import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** Only tab chrome is portaled. Terminal, file and plugin content never enters this slot. */
const WorkspaceSidebarContext = createContext<{
    target: HTMLDivElement | null;
    setTarget: (target: HTMLDivElement | null) => void;
} | null>(null);

export function WorkspaceSidebarProvider({ children }: { children: ReactNode }) {
    const [target, setTarget] = useState<HTMLDivElement | null>(null);
    const value = useMemo(() => ({ target, setTarget }), [target]);
    return <WorkspaceSidebarContext.Provider value={value}>{children}</WorkspaceSidebarContext.Provider>;
}

export const useWorkspaceSidebar = () => useContext(WorkspaceSidebarContext);
