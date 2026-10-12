import { applyCspStyleNonce } from '../../../lib/cspStyleNonce';
import { buildElementColorRules, terminalElementColorSignature } from './elementColorBindings';

export const ELEMENT_COLORS_CHANGED = 'zync:element-colors-changed';
export const TERMINAL_ELEMENT_COLORS_CHANGED = 'zync:terminal-element-colors-changed';

/** Own one nonce-authorized stylesheet; no body/root inline overrides or DOM reparenting. */
export function createElementColorStyle(root: Document, refreshTerminals: () => void) {
    let style: HTMLStyleElement | null = null;
    let rules = '';
    let terminalSignature = terminalElementColorSignature(undefined);
    let disposed = false;
    const update = (value: unknown) => {
        if (disposed) return;
        const next = buildElementColorRules(value);
        if (next !== rules) {
            rules = next;
            if (!next) { style?.remove(); style = null; }
            else {
                if (!style) {
                    style = root.createElement('style');
                    style.dataset.zyncElementColors = 'true';
                    applyCspStyleNonce(style, root);
                    style.textContent = next;
                    root.head.appendChild(style);
                } else style.textContent = next;
            }
            root.defaultView?.dispatchEvent(new Event(ELEMENT_COLORS_CHANGED));
        }
        const nextSignature = terminalElementColorSignature(value);
        if (terminalSignature !== nextSignature) {
            terminalSignature = nextSignature;
            refreshTerminals();
            root.defaultView?.dispatchEvent(new Event(TERMINAL_ELEMENT_COLORS_CHANGED));
        }
    };
    return {
        update,
        dispose() {
            if (disposed) return;
            update(undefined);
            disposed = true;
        },
    };
}
