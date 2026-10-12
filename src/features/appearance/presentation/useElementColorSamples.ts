import { useEffect, useState } from 'react';
import { ELEMENT_COLOR_KEYS, type ElementColorKey } from '../domain/elementColors';
import { opaqueCssColor } from '../domain/colorContrast';
import { ELEMENT_COLOR_BINDINGS } from './elementColorBindings';
import { ELEMENT_COLORS_CHANGED } from './elementColorStyle';

export type ElementColorSamples = Partial<Record<ElementColorKey, string | null>>;

/**
 * Read theme-token references, not the composed DOM. Preview overrides are applied
 * by the editor; transparency, status colors and nested feature content are not
 * misrepresented as audited live colors. No host discovery or layout reads needed.
 */
export function readElementColorSamples(root: Document): ElementColorSamples {
    const view = root.defaultView;
    if (!view) return {};
    const body = view.getComputedStyle(root.body);
    return Object.fromEntries(ELEMENT_COLOR_KEYS.map(key => {
        const binding = ELEMENT_COLOR_BINDINGS[key];
        // Unset terminal selection is translucent; do not pretend the accent itself is its background.
        const reference = key === 'terminal.selectionBackground' ? '' : body.getPropertyValue(binding.fallback);
        return [key, opaqueCssColor(reference)];
    }));
}

/** No polling or terminal-output subscription. Observers exist only while the editor is visible. */
export function useElementColorSamples(active: boolean, value: unknown): ElementColorSamples {
    const [samples, setSamples] = useState<ElementColorSamples>({});
    useEffect(() => {
        if (!active) return;
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => setSamples(readElementColorSamples(document)));
        };
        const observer = new MutationObserver(measure);
        for (const target of [document.body, document.documentElement]) {
            observer.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        }
        window.addEventListener(ELEMENT_COLORS_CHANGED, measure);
        window.addEventListener('zync:theme-registry-ready', measure);
        window.addEventListener('resize', measure);
        measure();
        return () => {
            observer.disconnect(); cancelAnimationFrame(frame);
            window.removeEventListener(ELEMENT_COLORS_CHANGED, measure);
            window.removeEventListener('zync:theme-registry-ready', measure);
            window.removeEventListener('resize', measure);
        };
    }, [active, value]);
    return samples;
}
