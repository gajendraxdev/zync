import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings } from '../../../store/settingsSlice';
import { useAppStore } from '../../../store/useAppStore';
import { getPluginCategory } from '../../editor/providers';
import { DEFAULT_GLOBAL_FONT_SIZE, DEFAULT_GLOBAL_FONT_STACK } from '../constants/defaults';
import { AppearanceColorsPanel } from './appearance/AppearanceColorsPanel';
import { AppearanceInterfaceSection } from './appearance/AppearanceInterfaceSection';
import { AppearanceElementColorsSection } from './appearance/AppearanceElementColorsSection';
import { AppearanceThemeFilesSection } from './appearance/AppearanceThemeFilesSection';
import { CUSTOM_THEME_ID, parseThemeDocument } from '../../../features/appearance/domain/themeDocument';
import { AppearanceInterfaceTypographySection } from './appearance/AppearanceInterfaceTypographySection';
import {
    getThemeAccent,
    normalizeHexColor,
    resolveAccentThemeName,
    resolveThemePluginId,
    type ThemePlugin,
} from './appearance/themeHelpers';

const GLOBAL_FONT_SIZE_MIN = 10;
const GLOBAL_FONT_SIZE_MAX = 24;

const APP_THEME_HINT = 'App-wide theme and accent — sidebar, panels, controls, and terminal ANSI colors.';

interface AppearanceTabProps {
    settings: AppSettings;
    plugins: ThemePlugin[];
    globalFontDraft: string;
    setGlobalFontDraft: (value: string) => void;
    updateSettings: (updates: Partial<AppSettings>) => Promise<void>;
}

export function AppearanceTab({
    settings,
    plugins,
    globalFontDraft,
    setGlobalFontDraft,
    updateSettings,
}: AppearanceTabProps) {
    const showToast = useAppStore((state) => state.showToast);
    const updateElementColors = useAppStore(state => state.updateElementColors);
    const importTheme = useAppStore(state => state.importTheme);
    const colorsLoading = useAppStore(state => state.isLoadingSettings || state.isReloadingSettings);

    const applyUpdate = async (updates: Partial<AppSettings>) => {
        try {
            await updateSettings(updates);
        } catch (error) {
            console.error('Failed to save appearance settings', error);
            const message = error instanceof Error ? error.message : String(error);
            showToast('error', `Failed to save appearance settings: ${message}`);
        }
    };

    const themePlugins = useMemo(
        () => plugins.filter(
            (plugin) => plugin.manifest.id !== 'com.zync.theme.manager'
                && getPluginCategory(plugin.manifest) === 'theme',
        ),
        [plugins],
    );
    const lightPlugins = useMemo(
        () => themePlugins.filter((plugin) => (plugin.manifest.mode ?? 'light') === 'light'),
        [themePlugins],
    );
    const darkPlugins = useMemo(
        () => themePlugins.filter((plugin) => plugin.manifest.mode === 'dark'),
        [themePlugins],
    );

    const resolveThemeAccent = (themeId: string) => {
        if (themeId === CUSTOM_THEME_ID) return parseThemeDocument(settings.customTheme)?.palette.accent ?? '#6366f1';
        const pluginId = resolveThemePluginId(themeId);
        const plugin = themePlugins.find((entry) => entry.manifest.id === pluginId);
        return getThemeAccent(plugin, resolveAccentThemeName(themeId));
    };

    const themeAccent = resolveThemeAccent(settings.theme);
    const normalizedAccentColor = normalizeHexColor(settings.accentColor);
    const normalizedThemeAccent = normalizeHexColor(themeAccent);
    const colorPickerValue = normalizedAccentColor ?? normalizedThemeAccent ?? '#6366f1';
    const [tempAccentColor, setTempAccentColor] = useState(colorPickerValue);

    useEffect(() => {
        setTempAccentColor(colorPickerValue);
    }, [colorPickerValue]);

    const selectTheme = (themeId: string) => {
        const normalized = normalizeHexColor(resolveThemeAccent(themeId)) ?? '#6366f1';
        setTempAccentColor(normalized);
        void applyUpdate({ theme: themeId, accentColor: null });
    };

    const commitAccentColor = () => {
        const normalizedTempAccentColor = normalizeHexColor(tempAccentColor);
        if (!normalizedTempAccentColor) {
            setTempAccentColor(colorPickerValue);
            return;
        }
        const themeDefaultAccent = normalizeHexColor(resolveThemeAccent(settings.theme)) ?? '#6366f1';
        if (!settings.accentColor && normalizedTempAccentColor === themeDefaultAccent) {
            setTempAccentColor(themeDefaultAccent);
            return;
        }
        if (normalizedTempAccentColor === colorPickerValue) {
            return;
        }
        setTempAccentColor(normalizedTempAccentColor);
        void applyUpdate({ accentColor: normalizedTempAccentColor });
    };

    const clampedGlobalFontSize = Math.max(
        GLOBAL_FONT_SIZE_MIN,
        Math.min(GLOBAL_FONT_SIZE_MAX, settings.globalFontSize ?? DEFAULT_GLOBAL_FONT_SIZE),
    );
    const [draftGlobalFontSize, setDraftGlobalFontSize] = useState(clampedGlobalFontSize);
    const lastSubmittedGlobalFontSizeRef = useRef<number | null>(null);

    useEffect(() => {
        setDraftGlobalFontSize(clampedGlobalFontSize);
        if (lastSubmittedGlobalFontSizeRef.current === clampedGlobalFontSize) {
            lastSubmittedGlobalFontSizeRef.current = null;
        }
    }, [clampedGlobalFontSize]);

    const commitGlobalFontSize = () => {
        const next = Math.max(
            GLOBAL_FONT_SIZE_MIN,
            Math.min(GLOBAL_FONT_SIZE_MAX, Number.parseInt(String(draftGlobalFontSize), 10) || DEFAULT_GLOBAL_FONT_SIZE),
        );
        if (next === clampedGlobalFontSize) {
            setDraftGlobalFontSize(next);
            lastSubmittedGlobalFontSizeRef.current = null;
            return;
        }
        if (next === lastSubmittedGlobalFontSizeRef.current) {
            setDraftGlobalFontSize(next);
            return;
        }
        lastSubmittedGlobalFontSizeRef.current = next;
        void applyUpdate({ globalFontSize: next });
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <AppearanceColorsPanel
                sectionTitle="Theme"
                hint={APP_THEME_HINT}
                settings={settings}
                lightPlugins={lightPlugins}
                darkPlugins={darkPlugins}
                themeAccent={themeAccent}
                tempAccentColor={tempAccentColor}
                onSelectTheme={selectTheme}
                onTempAccentColorChange={setTempAccentColor}
                onSelectPresetAccent={(color) => { void applyUpdate({ accentColor: color }); }}
                onCommitAccentColor={commitAccentColor}
            />
            <div className="h-px bg-[var(--color-app-border)]/20 my-2" />
            <AppearanceInterfaceTypographySection
                settings={settings}
                globalFontDraft={globalFontDraft}
                draftGlobalFontSize={draftGlobalFontSize}
                onGlobalFontDraftChange={setGlobalFontDraft}
                onApplyCustomFont={() => {
                    const next = globalFontDraft.trim();
                    if (next) {
                        void applyUpdate({ globalFontFamily: next });
                    }
                }}
                onGlobalFontFamilyChange={(value) => { void applyUpdate({ globalFontFamily: value }); }}
                onDraftGlobalFontSizeChange={setDraftGlobalFontSize}
                onCommitGlobalFontSize={commitGlobalFontSize}
                onResetTypography={() => {
                    void applyUpdate({
                        globalFontFamily: DEFAULT_GLOBAL_FONT_STACK,
                        globalFontSize: DEFAULT_GLOBAL_FONT_SIZE,
                    });
                }}
            />
            <div className="h-px bg-[var(--color-app-border)]/20 my-2" />
            <AppearanceInterfaceSection
                compactMode={settings.compactMode}
                onCompactModeChange={(checked) => { void applyUpdate({ compactMode: checked }); }}
            />
            <div className="h-px bg-[var(--color-app-border)]/20 my-2" />
            <AppearanceElementColorsSection value={settings.elementColors} active loading={colorsLoading} onChange={updateElementColors} />
            <div className="h-px bg-[var(--color-app-border)]/20 my-2" />
            <AppearanceThemeFilesSection settings={settings} loading={colorsLoading} onImport={importTheme} onSelectTheme={selectTheme} />
        </div>
    );
}
