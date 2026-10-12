import type { CSSProperties } from 'react';
import { colorContrast, opaqueCssColor } from '../domain/colorContrast';
import { parseElementColors } from '../domain/elementColors';
import { parseThemeDocument, THEME_PALETTE, THEME_PALETTE_KEYS, validateThemeDocument, type ThemeDocument } from '../domain/themeDocument';
import { ELEMENT_COLOR_BINDINGS } from './elementColorBindings';
import { ELEMENT_TEXT_CONTRAST_PAIRS } from './elementColorContrast';

/** Snapshot app-owned computed palette, not host backgrounds, plugin CSS or all settings.json. */
export function captureThemeDocument(root: Document, mode: ThemeDocument['mode'], elements: unknown, name: string): ThemeDocument {
    const style = root.defaultView!.getComputedStyle(root.body);
    const palette = Object.fromEntries(THEME_PALETTE_KEYS.map(key => {
        const color = opaqueCssColor(style.getPropertyValue(THEME_PALETTE[key]).trim());
        if (!color) throw new Error(`Cannot export ${key}: the current theme does not expose an opaque supported color.`);
        return [key, color];
    }));
    const colors = parseElementColors(elements);
    if (!colors) throw new Error('Cannot export unsupported element color preferences.');
    return validateThemeDocument({ format: 'zync-theme', version: 1, name, mode, palette, elements: colors });
}

/** Fixed tokens and validated values only; preview scope never modifies the live document. */
export function themePreviewStyle(theme: ThemeDocument): CSSProperties {
    const parsed = validateThemeDocument(theme);
    return Object.fromEntries(THEME_PALETTE_KEYS.map(key => [THEME_PALETTE[key], parsed.palette[key]])) as CSSProperties;
}
export function buildCustomThemeRules(value: unknown): string {
    const theme = parseThemeDocument(value);
    if (!theme) return '';
    // Extra fixed specificity wins over late-loaded builtin styles; custom accents remain inline-owned.
    return `:root:root,body[data-theme="custom"]{${THEME_PALETTE_KEYS.map(key => `${THEME_PALETTE[key]}:${theme.palette[key]};`).join('')}}`;
}

/** Advisory opaque foreground/background checks, not an accessibility certification. */
export function themeContrastWarnings(theme: ThemeDocument): string[] {
    const warnings: string[] = [];
    const effective = (key: keyof typeof ELEMENT_COLOR_BINDINGS) => theme.elements.overrides[key]
        ?? (key === 'terminal.selectionBackground' ? null : theme.palette[THEME_PALETTE_KEYS.find(token => THEME_PALETTE[token] === ELEMENT_COLOR_BINDINGS[key].fallback)!]);
    for (const pair of ELEMENT_TEXT_CONTRAST_PAIRS) {
        const ratio = colorContrast(effective(pair.foreground), effective(pair.background));
        if (ratio !== null && ratio < pair.minimum) warnings.push(`${pair.label}: text contrast ${ratio.toFixed(1)}:1 (recommended ${pair.minimum}:1).`);
    }
    return warnings;
}
