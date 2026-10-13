import type { ReactNode } from 'react';
import { Code2, Folder, Globe, Monitor, Server, Star, Terminal, type LucideIcon } from 'lucide-react';
import { TabDragPreview } from './TabDragPreview';
import { parseMainTabPresentation, resolveMainTabCloseButton, type MainTabIcon } from '../../features/workspace/domain/mainTabPresentation';
import { resolveDisplayTitle } from '../../features/workspace/domain/presentation';
import type { Tab } from '../../features/connections/domain/types';
import { PublicUrlsLabel } from '../share/PublicUrlsLabel';

const ICONS: Record<Exclude<MainTabIcon, 'none'>, LucideIcon> = {
    terminal: Terminal, server: Server, monitor: Monitor, folder: Folder,
    code: Code2, star: Star, globe: Globe,
};

/** Unsupported metadata inherits defaults; arbitrary saved values never reach style props. */
export function resolveWorkspaceTabAppearance(raw: unknown, active: boolean, defaultCloseButton?: unknown) {
    const parsed = parseMainTabPresentation(raw);
    const value = parsed.ok ? parsed.value : undefined;
    const closeButton = value?.closeButton ?? resolveMainTabCloseButton(defaultCloseButton);
    const showClose = closeButton !== 'hidden' && (closeButton !== 'active' || active);
    return {
        icon: value?.icon,
        accent: value?.accent,
        showClose,
        persistentClose: showClose && (closeButton === 'always' || closeButton === 'active'),
    };
}

/** Shared by live tabs and drag previews; resource icons remain the default. */
export function WorkspaceTabIcon({ icon, fallback, size = 12 }: {
    icon?: MainTabIcon;
    fallback: ReactNode;
    size?: number;
}) {
    if (icon === undefined) return <>{fallback}</>;
    if (icon === 'none') return null;
    const Icon = ICONS[icon];
    return <Icon size={size} aria-hidden="true" data-workspace-tab-icon={icon} />;
}

/** Decorative marker only: no text/background/status-color overrides or geometry changes. */
export function WorkspaceTabAccent({ accent }: { accent?: string }) {
    return accent ? <span aria-hidden="true" data-workspace-tab-accent
        className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded-full"
        style={{ backgroundColor: accent }} /> : null;
}

/** A visual drag clone, never a second tab/close control or resource host. */
export function WorkspaceTabDragPreview({ tab, active, icon }: { tab: Tab; active: boolean; icon: ReactNode }) {
    const appearance = resolveWorkspaceTabAppearance(tab.presentation, active);
    const title = resolveDisplayTitle(tab.title, tab.displayAlias);
    return <TabDragPreview icon={<WorkspaceTabIcon icon={appearance.icon} fallback={icon} size={13} />}
        decoration={<WorkspaceTabAccent accent={appearance.accent} />}>
        {tab.type === 'public-urls'
            ? <PublicUrlsLabel className="text-sm font-medium max-w-[140px]">{title}</PublicUrlsLabel>
            : <span className="truncate max-w-[120px]">{title}</span>}
    </TabDragPreview>;
}
