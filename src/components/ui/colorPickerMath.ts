export interface RGB { r: number; g: number; b: number }
export interface HSV { h: number; s: number; v: number }

/** Opaque sRGB only. This UI utility has no storage, CSS or feature authority. */
export function hexToRgb(value: string): RGB | null {
    if (!/^#[0-9a-f]{6}$/i.test(value)) return null;
    return { r: parseInt(value.slice(1, 3), 16), g: parseInt(value.slice(3, 5), 16), b: parseInt(value.slice(5, 7), 16) };
}

export function rgbToHex({ r, g, b }: RGB): string {
    return `#${[r, g, b].map(channel => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, '0')).join('')}`;
}

/** Preserve the last chosen hue for achromatic colors, so black/gray can regain color. */
export function rgbToHsv({ r, g, b }: RGB, previousHue = 0): HSV {
    const [red, green, blue] = [r, g, b].map(channel => channel / 255);
    const max = Math.max(red, green, blue); const min = Math.min(red, green, blue); const delta = max - min;
    const hue = delta === 0 ? previousHue : 60 * (max === red ? ((green - blue) / delta) % 6
        : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4);
    return { h: (hue + 360) % 360, s: max === 0 ? 0 : delta / max * 100, v: max * 100 };
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
    const hue = ((h % 360) + 360) % 360 / 60;
    const saturation = Math.min(100, Math.max(0, s)) / 100;
    const brightness = Math.min(100, Math.max(0, v)) / 100;
    const chroma = brightness * saturation; const x = chroma * (1 - Math.abs(hue % 2 - 1));
    const channels = hue < 1 ? [chroma, x, 0] : hue < 2 ? [x, chroma, 0] : hue < 3 ? [0, chroma, x]
        : hue < 4 ? [0, x, chroma] : hue < 5 ? [x, 0, chroma] : [chroma, 0, x];
    const [r, g, b] = channels.map(channel => Math.round((channel + brightness - chroma) * 255));
    return { r, g, b };
}

/** Pointer coordinates are bounded even when capture continues beyond the color field. */
export function colorFieldPoint(x: number, y: number, bounds: { left: number; top: number; width: number; height: number }) {
    const clamp = (value: number) => Math.min(100, Math.max(0, value));
    return { s: clamp((x - bounds.left) / Math.max(1, bounds.width) * 100),
        v: 100 - clamp((y - bounds.top) / Math.max(1, bounds.height) * 100) };
}
