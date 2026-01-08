import { useEffect } from 'react';
import { useConnections } from '../../context/ConnectionContext';
import { useSettings } from '../../context/SettingsContext';

export function ShortcutManager() {
    const { openTab, activeTabId, closeTab, openAddConnectionModal, activeConnectionId } = useConnections();
    const { openSettings, isSettingsOpen, closeSettings, updateSettings, settings } = useSettings();

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignore if input is focused (unless it's a command key that generally works)
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                // Allow some shortcuts
            }

            // Check for Modifier (Ctrl on Windows/Linux, Cmd on Mac)
            const isMod = e.ctrlKey || e.metaKey;

            if (!isMod) return;

            switch (e.key.toLowerCase()) {
                case 'b':
                    e.preventDefault();
                    updateSettings({ sidebarCollapsed: !settings.sidebarCollapsed });
                    break;
                case 'n':
                    e.preventDefault();
                    if (openAddConnectionModal) openAddConnectionModal();
                    break;
                case 't':
                    e.preventDefault();
                    if (e.shiftKey) {
                        // Shift+Mod+T: New Terminal in CURRENT active host
                        if (activeConnectionId) {
                            const event = new CustomEvent('ssh-ui:new-terminal-tab', {
                                detail: { connectionId: activeConnectionId }
                            });
                            window.dispatchEvent(event);
                        }
                    } else {
                        // Mod+T: Local Terminal
                        openTab('local');
                    }
                    break;
                case ',':
                    e.preventDefault();
                    if (isSettingsOpen) closeSettings();
                    else openSettings();
                    break;
                case 'w':
                    e.preventDefault();
                    if (activeTabId) {
                        closeTab(activeTabId);
                    }
                    break;
                case 'tab':
                    // Switch tabs
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [openTab, closeTab, activeTabId, activeConnectionId, isSettingsOpen, openSettings, closeSettings, openAddConnectionModal]);

    return null;
}
