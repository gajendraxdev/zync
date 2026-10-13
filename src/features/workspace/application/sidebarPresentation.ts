import { resolveWorkspaceNavigation } from '../domain/navigation';
import type { GlobalSidebarSection } from './globalNavigation';

/** All sidebar controls read the same transient section + persisted placement contract. */
export function sidebarPresentation(raw: unknown, selected: GlobalSidebarSection, savedCollapsed: boolean) {
    const navigation = resolveWorkspaceNavigation(raw);
    const docked = navigation.workspaceTabsPosition !== 'default';
    // Hiding the icon rail does not disable explicitly selected destinations.
    const section = selected === 'workspace' && !docked ? 'hosts' : selected;
    return { section, position: docked && navigation.workspaceTabsPosition === 'right' ? 'right' as const : 'left' as const,
        collapsed: (section !== 'workspace' && savedCollapsed) || section === null };
}

interface SidebarVisibilityState {
    globalSidebarSection: GlobalSidebarSection;
    lastGlobalSidebarSection?: GlobalSidebarSection;
    globalSidebarSelectionRevision: number;
    settingsLoadGeneration: number;
    settings: { workspaceNavigation?: unknown; sidebarCollapsed: boolean };
    setGlobalSidebarSection: (section: GlobalSidebarSection, rememberedSection?: GlobalSidebarSection) => void;
    updateSettings: (patch: { sidebarCollapsed: boolean }) => Promise<void>;
    showToast: (type: 'error', message: string) => void;
}

/** Save visibility and recover transient selection only while this action still owns it.
 * The revision detects even select-away/select-back cycles; preference identity
 * also prevents a late failure from undoing a newly acknowledged strip placement.
 */
export function setSidebarVisibility(get: () => SidebarVisibilityState, collapsed: boolean,
    section?: GlobalSidebarSection): void {
    const before = get();
    const selected = section === undefined ? before.globalSidebarSection ?? before.lastGlobalSidebarSection ?? 'hosts' : section;
    const next = collapsed && selected === 'workspace' ? null : selected;
    const revision = before.globalSidebarSelectionRevision + 1;
    before.setGlobalSidebarSection(next);
    if (get().globalSidebarSelectionRevision !== revision) return;
    void before.updateSettings({ sidebarCollapsed: collapsed }).catch(() => {
        const current = get();
        if (current.globalSidebarSelectionRevision === revision && current.globalSidebarSection === next
            && current.settingsLoadGeneration === before.settingsLoadGeneration
            && current.settings.workspaceNavigation === before.settings.workspaceNavigation
            && current.settings.sidebarCollapsed === before.settings.sidebarCollapsed) {
            current.setGlobalSidebarSection(before.globalSidebarSection, before.lastGlobalSidebarSection);
        }
        current.showToast('error', 'Could not save sidebar visibility.');
    });
}
