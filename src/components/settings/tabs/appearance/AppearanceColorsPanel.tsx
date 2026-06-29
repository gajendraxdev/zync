import type { FocusEvent } from 'react';
import type { AppSettings } from '../../../../store/settingsSlice';
import { AppearanceAccentSection } from './AppearanceAccentSection';
import { AppearanceThemeSection } from './AppearanceThemeSection';
import type { ThemePlugin } from './themeHelpers';

export interface AppearanceColorsPanelProps {
    sectionTitle: string;
    hint: string;
    settings: AppSettings;
    lightPlugins: ThemePlugin[];
    darkPlugins: ThemePlugin[];
    themeAccent: string;
    tempAccentColor: string;
    onSelectTheme: (themeId: string) => void;
    onTempAccentColorChange: (color: string) => void;
    onSelectPresetAccent: (color: string | null) => void;
    onCommitAccentColor: () => void;
    onColorInputBlur: (event: FocusEvent<HTMLInputElement>) => void;
}

export function AppearanceColorsPanel({
    sectionTitle,
    hint,
    settings,
    lightPlugins,
    darkPlugins,
    themeAccent,
    tempAccentColor,
    onSelectTheme,
    onTempAccentColorChange,
    onSelectPresetAccent,
    onCommitAccentColor,
    onColorInputBlur,
}: AppearanceColorsPanelProps) {
    return (
        <>
            <AppearanceThemeSection
                sectionTitle={sectionTitle}
                settings={settings}
                lightPlugins={lightPlugins}
                darkPlugins={darkPlugins}
                hint={hint}
                onSelectTheme={onSelectTheme}
            />
            <div className="h-px bg-[var(--color-app-border)]/20 my-2" />
            <AppearanceAccentSection
                settings={settings}
                themeAccent={themeAccent}
                tempAccentColor={tempAccentColor}
                onTempAccentColorChange={onTempAccentColorChange}
                onSelectPresetAccent={onSelectPresetAccent}
                onCommitAccentColor={onCommitAccentColor}
                onColorInputBlur={onColorInputBlur}
            />
        </>
    );
}