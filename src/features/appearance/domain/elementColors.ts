import catalog from './elementColorCatalog.json' with { type: 'json' };

export type ElementColorKey = keyof typeof catalog;
export type ElementColorArea = ElementColorKey extends `${infer Area}.${string}` ? Area : never;
export interface ElementColors {
    version: 1;
    /** Absent keys inherit the selected theme. Values are opaque six-digit sRGB. */
    overrides: Partial<Record<ElementColorKey, string>>;
}
export type ElementColorChange =
    | { type: 'set'; key: ElementColorKey; color: string }
    | { type: 'reset'; key: ElementColorKey }
    | { type: 'reset-area'; area: ElementColorArea }
    | { type: 'reset-all' };

/** One finite registry is shared with native validation; it grants no CSS/DOM authority. */
export const ELEMENT_COLOR_KEYS = Object.freeze(Object.keys(catalog) as ElementColorKey[]);
export const ELEMENT_COLOR_DEFINITIONS = Object.freeze(ELEMENT_COLOR_KEYS.map(key => Object.freeze({
    key, label: catalog[key].label, areaLabel: catalog[key].area,
    // Stable IDs, not translated display labels, address reset operations.
    area: key.slice(0, key.indexOf('.')) as ElementColorArea,
})));
export const ELEMENT_COLOR_AREAS = Object.freeze([...new Set(ELEMENT_COLOR_DEFINITIONS.map(entry => entry.area))]);
const keySet: ReadonlySet<string> = new Set(ELEMENT_COLOR_KEYS);

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strict persisted syntax: no alpha, CSS functions, variables, URLs or arbitrary names. */
export function normalizeElementColor(value: unknown): string | null {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/** Copy supported data into canonical key order; unknown formats must remain raw in storage. */
export function parseElementColors(value: unknown): ElementColors | null {
    if (value === undefined) return { version: 1, overrides: {} };
    if (!record(value) || value.version !== 1 || Object.keys(value).length !== 2
        || !record(value.overrides) || !Object.prototype.hasOwnProperty.call(value, 'version')
        || !Object.prototype.hasOwnProperty.call(value, 'overrides')) return null;
    const input = value.overrides;
    if (Object.keys(input).some(key => !keySet.has(key))) return null;
    const overrides: ElementColors['overrides'] = {};
    for (const key of ELEMENT_COLOR_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        const color = normalizeElementColor(input[key]);
        if (!color) return null;
        overrides[key] = color;
    }
    return { version: 1, overrides };
}

/** Validate UI intent before it can enter a queue; return a detached, bounded action. */
export function prepareElementColorChange(change: ElementColorChange): ElementColorChange | null {
    if (!record(change)) return null;
    if (change.type === 'reset-all') return { type: 'reset-all' };
    if (change.type === 'reset-area') return ELEMENT_COLOR_AREAS.includes(change.area) ? { type: 'reset-area', area: change.area } : null;
    if (!keySet.has(change.key)) return null;
    if (change.type === 'reset') return { type: 'reset', key: change.key };
    if (change.type !== 'set') return null;
    const color = normalizeElementColor(change.color);
    return color ? { type: 'set', key: change.key, color } : null;
}

/** Reset removes only overrides, not theme selection, accent, fonts or terminal behavior. */
export function changeElementColors(current: ElementColors, change: ElementColorChange): ElementColors | null {
    const action = prepareElementColorChange(change);
    const next = parseElementColors(current);
    if (!next || !action) return null;
    switch (action.type) {
        case 'set': next.overrides[action.key] = action.color; break;
        case 'reset': delete next.overrides[action.key]; break;
        case 'reset-area':
            for (const entry of ELEMENT_COLOR_DEFINITIONS) if (entry.area === action.area) delete next.overrides[entry.key];
            break;
        case 'reset-all': next.overrides = {}; break;
    }
    return parseElementColors(next);
}
