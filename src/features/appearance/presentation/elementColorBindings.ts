import { ELEMENT_COLOR_KEYS, parseElementColors, type ElementColorKey } from '../domain/elementColors';

type ColorProperty = 'background-color' | 'color' | 'border-color' | `--zync-element-terminal-${string}`;
export interface ElementColorBinding { selector: string; property: ColorProperty; fallback: string }
const element = (name: string) => `[data-zync-color="${name}"]`;
const selected = (name: string) => `${element(name)}[data-zync-selected="true"]`;
const labeled = (name: string) => `:is(${element(name)}, ${element(name)} [data-zync-color-label])`;
const binding = (selector: string, property: ColorProperty, fallback: string): ElementColorBinding => ({ selector, property, fallback });
// Fixed host selectors only. User data can supply a validated hex value, never a selector.
export const ELEMENT_COLOR_BINDINGS: Readonly<Record<ElementColorKey, ElementColorBinding>> = {
    'mainTabs.background': binding(element('mainTabs'), 'background-color', '--color-app-bg'),
    'mainTabs.foreground': binding(element('mainTab'), 'color', '--color-app-muted'),
    'mainTabs.border': binding(element('mainTabs'), 'border-color', '--color-app-border'),
    'mainTabs.activeBackground': binding(selected('mainTab'), 'background-color', '--color-app-surface'),
    'mainTabs.activeForeground': binding(selected('mainTab'), 'color', '--color-app-text'),
    'contentTabs.background': binding(element('contentTabs'), 'background-color', '--color-app-panel'),
    'contentTabs.foreground': binding(element('contentTab'), 'color', '--color-app-muted'),
    'contentTabs.border': binding(element('contentTabs'), 'border-color', '--color-app-border'),
    'contentTabs.activeBackground': binding(selected('contentTab'), 'background-color', '--color-app-surface'),
    'contentTabs.activeForeground': binding(selected('contentTab'), 'color', '--color-app-text'),
    'paneHeader.background': binding(element('paneHeader'), 'background-color', '--color-app-panel'),
    'paneHeader.foreground': binding(`${element('paneHeader')} [data-zync-color-label]`, 'color', '--color-app-text'),
    'paneHeader.border': binding(element('paneHeader'), 'border-color', '--color-app-border'),
    'navigation.background': binding(element('navigation'), 'background-color', '--color-app-panel'),
    'navigation.foreground': binding(element('navigationItem'), 'color', '--color-app-muted'),
    'navigation.border': binding(element('navigation'), 'border-color', '--color-app-border'),
    'navigation.hoverBackground': binding(`${element('navigationItem')}:hover:not(:disabled)`, 'background-color', '--color-app-surface'),
    'sidebar.background': binding(element('sidebar'), 'background-color', '--color-app-panel'),
    'sidebar.foreground': binding(labeled('sidebar'), 'color', '--color-app-text'),
    'sidebar.border': binding(element('sidebar'), 'border-color', '--color-app-border'),
    'panel.background': binding(element('panel'), 'background-color', '--color-app-bg'),
    'panel.foreground': binding(element('panel'), 'color', '--color-app-text'),
    'panel.border': binding(element('panel'), 'border-color', '--color-app-border'),
    'statusBar.background': binding(element('statusBar'), 'background-color', '--color-app-panel'),
    'statusBar.foreground': binding(labeled('statusBar'), 'color', '--color-app-text'),
    'statusBar.border': binding(element('statusBar'), 'border-color', '--color-app-border'),
    'control.background': binding(element('control'), 'background-color', '--color-app-surface'),
    'control.foreground': binding(element('control'), 'color', '--color-app-text'),
    'control.border': binding(`${element('control')}:not(:focus-visible)`, 'border-color', '--color-app-border'),
    'terminal.background': binding('body', '--zync-element-terminal-background', '--color-app-bg'),
    'terminal.foreground': binding('body', '--zync-element-terminal-foreground', '--color-app-text'),
    'terminal.cursor': binding('body', '--zync-element-terminal-cursor', '--color-app-accent'),
    'terminal.selectionBackground': binding('body', '--zync-element-terminal-selection', '--color-app-accent'),
};

/** Exclude protected dialogs, explicitly protected surfaces, errors and their descendants. */
export function elementColorSelector(key: ElementColorKey): string {
    return `${ELEMENT_COLOR_BINDINGS[key].selector}:not([role="dialog"], [role="alertdialog"], [data-zync-color-protected], [aria-invalid="true"], [role="dialog"] *, [role="alertdialog"] *, [data-zync-color-protected] *, [aria-invalid="true"] *)`;
}

/** Emit no rule for missing/unsupported values, preserving the existing theme cascade exactly. */
export function buildElementColorRules(value: unknown): string {
    const colors = parseElementColors(value);
    if (!colors) return '';
    return ELEMENT_COLOR_KEYS.flatMap(key => {
        const color = colors.overrides[key];
        return color ? [`${elementColorSelector(key)}{${ELEMENT_COLOR_BINDINGS[key].property}:${color};}`] : [];
    }).join('\n');
}

/** Terminal refresh is separate from host chrome; unrelated color edits never repaint xterm. */
export function terminalElementColorSignature(value: unknown): string {
    const overrides = parseElementColors(value)?.overrides;
    return ELEMENT_COLOR_KEYS.filter(key => key.startsWith('terminal.')).map(key => overrides?.[key] ?? '').join('|');
}
