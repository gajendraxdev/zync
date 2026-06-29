import type { MouseEvent } from 'react';

export const THEME_PREFIX = 'com.zync.theme.';

export interface ThemePluginManifest {
    id: string;
    name: string;
    mode?: 'light' | 'dark';
    preview_bg?: string;
    preview_accent?: string;
}

export interface ThemePlugin {
    manifest: ThemePluginManifest;
}

export function getThemeId(pluginId: string): string {
    return pluginId.replace(THEME_PREFIX, '');
}

export function getThemeAccent(plugin: ThemePlugin | undefined, themeName: string): string {
    if (plugin?.manifest.preview_accent) {
        return plugin.manifest.preview_accent;
    }
    if (themeName === 'dark') {
        return '#797bce';
    }
    if (themeName === 'light') {
        return '#6366f1';
    }
    if (themeName === 'system') {
        if (
            typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-color-scheme: dark)').matches
        ) {
            return '#797bce';
        }
        return '#6366f1';
    }
    return '#6366f1';
}

export function normalizeHexColor(value: string | null | undefined): string | null {
    if (!value) {
        return null;
    }
    const trimmed = value.trim();
    const shortMatch = /^#([0-9A-Fa-f]{3})$/.exec(trimmed);
    if (shortMatch) {
        const [r, g, b] = shortMatch[1].split('');
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }
    const fullMatch = /^#([0-9A-Fa-f]{6})$/.exec(trimmed);
    if (fullMatch) {
        return `#${fullMatch[1]}`.toLowerCase();
    }
    return null;
}

export function preventBlurBeforeClick(event: MouseEvent): void {
    event.preventDefault();
}

export function resolveThemePluginId(themeId: string): string {
    return themeId.startsWith(THEME_PREFIX) ? themeId : `${THEME_PREFIX}${themeId}`;
}

export function resolveAccentThemeName(themeId: string): string {
    return themeId.startsWith(THEME_PREFIX) ? getThemeId(themeId) : themeId;
}