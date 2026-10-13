import { ELEMENT_COLOR_AREAS, ELEMENT_COLOR_DEFINITIONS, type ElementColorKey } from '../domain/elementColors';

interface ContrastPair { label: string; foreground: ElementColorKey; background: ElementColorKey; minimum: number }

/** Shared readable-text states for both the per-color editor and portable import warnings. */
export const ELEMENT_TEXT_CONTRAST_PAIRS: readonly ContrastPair[] = [
    ...ELEMENT_COLOR_AREAS.map(area => ({ label: ELEMENT_COLOR_DEFINITIONS.find(field => field.area === area)!.areaLabel,
        foreground: `${area}.foreground` as ElementColorKey, background: `${area}.background` as ElementColorKey, minimum: 4.5 })),
    { label: 'Main tabs · active', foreground: 'mainTabs.activeForeground', background: 'mainTabs.activeBackground', minimum: 4.5 },
    { label: 'Content tabs · active', foreground: 'contentTabs.activeForeground', background: 'contentTabs.activeBackground', minimum: 4.5 },
    { label: 'Navigation · hover', foreground: 'navigation.foreground', background: 'navigation.hoverBackground', minimum: 4.5 },
    { label: 'Terminal · selection', foreground: 'terminal.foreground', background: 'terminal.selectionBackground', minimum: 4.5 },
];

/** Border/cursor separation is advisory at 3:1; text states use the same 4.5:1 pairs. */
export function elementContrastPair(key: ElementColorKey): ContrastPair {
    const field = ELEMENT_COLOR_DEFINITIONS.find(entry => entry.key === key)!;
    if (key.endsWith('.border') || key === 'terminal.cursor') return {
        label: field.areaLabel, foreground: key, background: `${field.area}.background` as ElementColorKey, minimum: 3,
    };
    return ELEMENT_TEXT_CONTRAST_PAIRS.find(pair => pair.foreground === key || pair.background === key)!;
}
