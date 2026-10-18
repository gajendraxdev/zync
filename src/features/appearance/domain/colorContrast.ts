import { normalizeElementColor } from './elementColors';

/** Decode opaque sRGB only; unknown/transparent theme colors must not get a false contrast score. */
export function opaqueCssColor(value: string): string | null {
    const text = value.trim();
    const hex = normalizeElementColor(text);
    if (hex) return hex;
    if (/^#[0-9a-f]{3}$/i.test(text)) return `#${text.slice(1).split('').map(ch => ch + ch).join('')}`.toLowerCase();
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(text)
        ?? /^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/i.exec(text);
    if (!rgb || (rgb[4] !== undefined && Number(rgb[4]) !== 1)) return null;
    const channels = rgb.slice(1, 4).map(Number);
    if (channels.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null;
    return `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/** WCAG sRGB relative luminance: https://www.w3.org/WAI/WCAG21/Techniques/general/G18 */
function luminance(hex: string): number {
    const channels = [1, 3, 5].map(start => {
        const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

/** The score is advisory for an opaque pair, not certification of a composed/translucent UI. */
export function colorContrast(foreground: string | null, background: string | null): number | null {
    const fg = foreground && opaqueCssColor(foreground);
    const bg = background && opaqueCssColor(background);
    if (!fg || !bg) return null;
    const a = luminance(fg); const b = luminance(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Choose the more legible sRGB endpoint; unsupported/translucent colors retain the caller's fallback. */
export function contrastingForeground(background: string): '#000000' | '#ffffff' | null {
    const black = colorContrast('#000000', background);
    const white = colorContrast('#ffffff', background);
    return black === null || white === null ? null : black >= white ? '#000000' : '#ffffff';
}
