import type { AppSettings } from '../../../store/settingsSlice';
import { useAppStore } from '../../../store/useAppStore';
import { NavigationSection } from './layout/NavigationSection';
import { WorkspaceTabsSection } from './layout/WorkspaceTabsSection';
import { ChromeActionsSection } from './layout/ChromeActionsSection';
import { StatusBarSection } from './layout/StatusBarSection';

interface LayoutNavigationTabProps {
    settings: AppSettings;
    updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
    updateStatusBarSettings: (updates: Partial<AppSettings['statusBar']>) => Promise<void>;
}

/** Composes chrome preferences only; live pane/session ownership stays in the workspace. */
export function LayoutNavigationTab({ settings, updateSettings, updateStatusBarSettings }: LayoutNavigationTabProps) {
    const updateWorkspaceNavigation = useAppStore(state => state.updateWorkspaceNavigation);
    const updateChromeActions = useAppStore(state => state.updateChromeActions);
    const loading = useAppStore(state => state.isLoadingSettings || state.isReloadingSettings);
    return <div className="space-y-6 animate-in fade-in duration-300">
        <NavigationSection value={settings.workspaceNavigation} onChange={updateWorkspaceNavigation} />
        <WorkspaceTabsSection closeButtonMode={settings.mainTabCloseButton}
            onCloseButtonModeChange={mode => { void updateSettings({ mainTabCloseButton: mode }); }} />
        <ChromeActionsSection value={settings.chromeActions} area="workspaceToolbar" loading={loading} onChange={updateChromeActions} />
        <StatusBarSection settings={settings} updateStatusBarSettings={updateStatusBarSettings} />
    </div>;
}
