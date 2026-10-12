import catalog from './themePaletteCatalog.json' with { type: 'json' };
import nameWhitespace from './themeNameWhitespace.json' with { type: 'json' };
import { normalizeElementColor, parseElementColors, type ElementColors } from './elementColors';

export const CUSTOM_THEME_ID = 'custom';
export const THEME_FILE_MAX_BYTES = 64 * 1024;
export const THEME_PALETTE = Object.freeze(catalog);
export type ThemePaletteKey = keyof typeof catalog;
export const THEME_PALETTE_KEYS = Object.freeze(Object.keys(catalog) as ThemePaletteKey[]);
export interface ThemeDocument {
    format: 'zync-theme';
    version: 1;
    name: string;
    mode: 'light' | 'dark';
    palette: Record<ThemePaletteKey, string>;
    elements: ElementColors;
}
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) =>
    Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));

const nameEdges = new Set(nameWhitespace);
/** Finite whitespace contract shared with Rust; ASCII controls are rejected before trimming. */
export function normalizeThemeName(value: string): string {
    const chars = Array.from(value);
    let start = 0; let end = chars.length;
    while (start < end && nameEdges.has(chars[start])) start++;
    while (end > start && nameEdges.has(chars[end - 1])) end--;
    return chars.slice(start, end).join('');
}

/** Portable colors only. Never accept settings, selectors, CSS, URLs or executable plugin data. */
export function validateThemeDocument(value: unknown): ThemeDocument {
    if (!record(value) || !exactKeys(value, ['format', 'version', 'name', 'mode', 'palette', 'elements']))
        throw new Error('Expected a Zync theme with format, version, name, mode, palette and elements only.');
    if (value.format !== 'zync-theme') throw new Error('This is not a Zync theme file. Export a theme from Appearance first.');
    if (value.version !== 1) throw new Error('Unsupported theme version. This app supports version 1.');
    const name = typeof value.name === 'string' ? normalizeThemeName(value.name) : '';
    if (name.length < 1 || name.length > 80
        || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Theme name must contain 1–80 characters, without control characters.');
    if (value.mode !== 'light' && value.mode !== 'dark') throw new Error('Theme mode must be light or dark.');
    if (!record(value.palette) || !exactKeys(value.palette, THEME_PALETTE_KEYS))
        throw new Error(`Palette must contain exactly: ${THEME_PALETTE_KEYS.join(', ')}.`);
    const palette = {} as ThemeDocument['palette'];
    for (const key of THEME_PALETTE_KEYS) {
        const color = normalizeElementColor(value.palette[key]);
        if (!color) throw new Error(`palette.${key}: expected a six-digit hex color, such as #6366f1.`);
        palette[key] = color;
    }
    // Undefined is a valid empty preference, but the portable file requires an explicit envelope.
    const elements = value.elements === undefined ? null : parseElementColors(value.elements);
    if (!elements) throw new Error('Invalid elements. Use version 1, overrides, known element keys and six-digit hex colors only.');
    return { format: 'zync-theme', version: 1, name, mode: value.mode, palette, elements };
}

export function parseThemeDocument(value: unknown): ThemeDocument | null {
    try { return validateThemeDocument(value); } catch { return null; }
}

/** Check UTF-8 bytes before parsing; no partially validated result escapes this boundary. */
export function readThemeJson(text: string): ThemeDocument {
    if (new TextEncoder().encode(text).length > THEME_FILE_MAX_BYTES) throw new Error('Theme files must be 64 KB or smaller.');
    let value: unknown;
    try { value = JSON.parse(text.replace(/^\uFEFF/, '')); }
    catch { throw new Error('Invalid JSON. Check commas, quotes and brackets in the theme file.'); }
    return validateThemeDocument(value);
}

export function writeThemeJson(value: unknown): string {
    return `${JSON.stringify(validateThemeDocument(value), null, 2)}\n`;
}

/** Compare exactly the affected settings; absent native fields use the existing frontend defaults. */
export interface ThemeSettingsSnapshot {
    theme: string;
    accentColor: string | null;
    customTheme: unknown;
    elementColors: unknown;
}
export function themeSettingsSnapshot(settings: { theme: string; accentColor?: string | null; customTheme?: unknown; elementColors?: unknown }): ThemeSettingsSnapshot {
    return { theme: settings.theme, accentColor: settings.accentColor ?? null,
        customTheme: settings.customTheme ?? null, elementColors: settings.elementColors ?? null };
}
export function sameThemeSettings(left: ThemeSettingsSnapshot, right: ThemeSettingsSnapshot): boolean {
    return left.theme === right.theme && left.accentColor === right.accentColor
        && left.customTheme === right.customTheme && left.elementColors === right.elementColors;
}
export function parseThemeSettings(value: unknown): ThemeSettingsSnapshot | null {
    if (!record(value) || !exactKeys(value, ['theme', 'accentColor', 'customTheme', 'elementColors'])
        || typeof value.theme !== 'string' || (value.accentColor !== null && typeof value.accentColor !== 'string')) return null;
    const customTheme = value.customTheme === null ? null : parseThemeDocument(value.customTheme);
    const elementColors = value.elementColors === null ? null : parseElementColors(value.elementColors);
    if ((value.customTheme !== null && !customTheme) || (value.elementColors !== null && !elementColors)) return null;
    return { theme: value.theme, accentColor: value.accentColor as string | null, customTheme, elementColors };
}
