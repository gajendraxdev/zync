import { useLayoutEffect } from 'react';
import { applyCspStyleNonce } from '../../../lib/cspStyleNonce';
import { CUSTOM_THEME_ID } from '../domain/themeDocument';
import { buildCustomThemeRules } from './themeDocumentPresentation';

/** One host-owned, nonce-authorized palette. Builtin/plugin styles are never edited. */
export function useCustomThemeStyle(themeId: string, value: unknown): void {
    useLayoutEffect(() => {
        if (themeId !== CUSTOM_THEME_ID) return;
        const rules = buildCustomThemeRules(value);
        if (!rules) return;
        const style = document.createElement('style');
        style.dataset.zyncCustomTheme = 'true';
        applyCspStyleNonce(style, document);
        style.textContent = rules;
        document.head.appendChild(style);
        return () => { style.remove(); };
    }, [themeId, value]);
}
