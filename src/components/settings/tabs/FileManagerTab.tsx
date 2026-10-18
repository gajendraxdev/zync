import { useState } from 'react';
import type { AppSettings } from '../../../store/settingsSlice';
import { useAppStore } from '../../../store/useAppStore';
import { FILE_RECENT_LIMIT_CHOICES, clampFileRecentLimit } from '../../file-manager/fileChrome';
import { Button } from '../../ui/Button';
import { Toolbar } from '../../ui/Toolbar';
import { Section } from '../common/Section';
import { Toggle } from '../common/Toggle';

interface FileManagerTabProps {
    settings: AppSettings;
    updateFileManagerSettings: (updates: Partial<AppSettings['fileManager']>) => Promise<void>;
    onPickDefaultDownloadPath: () => Promise<void>;
}

export function FileManagerTab({
    settings,
    updateFileManagerSettings,
    onPickDefaultDownloadPath
}: FileManagerTabProps) {
    const [isUpdating, setIsUpdating] = useState(false);
    const showToast = useAppStore((state) => state.showToast);

    const runUpdate = async (work: () => Promise<void>) => {
        setIsUpdating(true);
        try {
            await work();
        } catch (error) {
            console.error('Failed to update file manager settings', error);
            const message = error instanceof Error ? error.message : String(error);
            showToast('error', `Failed to save file manager setting: ${message}`);
        } finally {
            setIsUpdating(false);
        }
    };

    return (
        <div className="space-y-6">
            <Section title="Behavior">
                <div className="space-y-4">
                    <Toggle
                        label="Show Hidden Files"
                        description="Display files starting with ."
                        checked={settings.fileManager.showHiddenFiles}
                        disabled={isUpdating}
                        onChange={(v) => { void runUpdate(() => updateFileManagerSettings({ showHiddenFiles: v })); }}
                    />
                    <Toggle label="Show Folder Sizes" checked={settings.fileManager.showFolderSizes !== false}
                        disabled={isUpdating}
                        description="Calculate logical file bytes in the background within safety limits, not allocated disk space. SSH scans use server metadata."
                        onChange={value => { void runUpdate(() => updateFileManagerSettings({ showFolderSizes: value })); }} />
                    <Toggle
                        label="Confirm Deletion"
                        description="Ask for confirmation before deleting files"
                        checked={settings.fileManager.confirmDelete}
                        disabled={isUpdating}
                        onChange={(v) => { void runUpdate(() => updateFileManagerSettings({ confirmDelete: v })); }}
                    />
                    <Toggle
                        label="Sort Folders Before Files"
                        description="Keep directories at the top of grid and list views"
                        checked={settings.fileManager.sortFoldersFirst !== false}
                        disabled={isUpdating}
                        onChange={(v) => { void runUpdate(() => updateFileManagerSettings({ sortFoldersFirst: v })); }}
                    />
                    <Toggle
                        label="Single-click to Open"
                        description="Open files and folders with one click instead of two"
                        checked={settings.fileManager.clickPolicy === 'single'}
                        disabled={isUpdating}
                        onChange={(v) => { void runUpdate(() => updateFileManagerSettings({ clickPolicy: v ? 'single' : 'double' })); }}
                    />
                    <div className="p-4 bg-[var(--color-app-surface)]/50 rounded-lg border border-[var(--color-app-border)]/50">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="min-w-0 flex-1 basis-40">
                                <div className="text-sm font-medium text-[var(--color-app-text)]">Default Download Folder</div>
                                <div
                                    className="text-xs text-[var(--color-app-muted)] mt-1 truncate"
                                    title={settings.fileManager.defaultDownloadPath || 'Ask every time'}
                                >
                                    {settings.fileManager.defaultDownloadPath || 'Ask every time'}
                                </div>
                            </div>
                            <Toolbar label="Default download folder actions">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={isUpdating}
                                    onClick={() => { void runUpdate(onPickDefaultDownloadPath); }}
                                >
                                    Browse
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={isUpdating}
                                    onClick={() => { void runUpdate(() => updateFileManagerSettings({ defaultDownloadPath: '' })); }}
                                >
                                    Reset
                                </Button>
                            </Toolbar>
                        </div>
                    </div>
                </div>
            </Section>
            <Section title="Places">
                <div className="space-y-4">
                    <Toggle
                        label="Show Recent"
                        description="List recent folders in the Places sidebar. Right-click Recent there for the same options."
                        checked={settings.fileManager.placesRecentEnabled !== false}
                        disabled={isUpdating}
                        onChange={(v) => { void runUpdate(() => updateFileManagerSettings({ placesRecentEnabled: v })); }}
                    />
                    <div className="p-4 bg-[var(--color-app-surface)]/50 rounded-lg border border-[var(--color-app-border)]/50">
                        <div className="text-sm font-medium text-[var(--color-app-text)]">Recent folders to keep</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {FILE_RECENT_LIMIT_CHOICES.map((count) => {
                                const active = clampFileRecentLimit(settings.fileManager.placesRecentLimit) === count;
                                return (
                                    <button
                                        key={count}
                                        type="button"
                                        disabled={isUpdating}
                                        onClick={() => { void runUpdate(() => updateFileManagerSettings({ placesRecentLimit: count })); }}
                                        className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 ${
                                            active
                                                ? 'border-[var(--color-app-accent)]/60 bg-[var(--color-app-accent)]/10 text-[var(--color-app-text)]'
                                                : 'border-[var(--color-app-border)] bg-[var(--color-app-bg)] text-[var(--color-app-muted)] hover:text-[var(--color-app-text)]'
                                        }`}
                                    >
                                        {count}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </Section>
        </div>
    );
}
