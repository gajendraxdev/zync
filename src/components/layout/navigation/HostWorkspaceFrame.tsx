import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAppStore } from '../../../store/useAppStore';
import { resolveWorkspaceNavigation } from '../../../features/workspace/domain/navigation';
import { useWorkspaceSidebar } from './WorkspaceSidebarContext';

/** Only chrome allocation changes. Live pane hosts keep the same parent and DOM order. */
export function HostWorkspaceFrame({ navigation, children, active = true }: { navigation: ReactNode; children: ReactNode; active?: boolean }) {
    const raw = useAppStore(state => state.settings.workspaceNavigation);
    const position = resolveWorkspaceNavigation(raw).workspaceTabsPosition ?? 'default';
    const vertical = position !== 'default';
    const sidebar = useWorkspaceSidebar();
    return <div data-host-workspace-position={position} className="grid flex-1 min-h-0 min-w-0 overflow-hidden"
        style={{ gridTemplateColumns: 'auto minmax(0, 1fr) auto', gridTemplateRows: 'auto minmax(0, 1fr)' }}>
        <div data-host-navigation-slot className="min-h-0 min-w-0" style={{ gridRow: 1, gridColumn: '1 / 4' }}>
            {vertical ? (active && sidebar?.target ? createPortal(navigation, sidebar.target) : null) : navigation}
        </div>
        <div data-host-workspace-body className="flex min-h-0 min-w-0 overflow-hidden relative" style={{ gridRow: vertical ? '1 / 3' : 2, gridColumn: 2 }}>
            {children}
        </div>
    </div>;
}
