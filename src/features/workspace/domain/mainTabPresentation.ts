import { reorderItemsById } from './presentation';
import iconLabels from './mainTabIcons.json' with { type: 'json' };

export const MAIN_TAB_PRESENTATION_VERSION = 2 as const;
export type MainTabIcon = keyof typeof iconLabels;
export type MainTabCloseButton = 'always' | 'active' | 'hidden';
export type MainTabCloseButtonMode = 'hover' | MainTabCloseButton;
export const MAIN_TAB_CLOSE_BUTTON_OPTIONS = Object.freeze([
    { value: 'hover', label: 'On hover or focus (default)' },
    { value: 'always', label: 'Always visible' },
    { value: 'active', label: 'Active tab only' },
    { value: 'hidden', label: 'Hidden in tab strip' },
]);
export function resolveMainTabCloseButton(value: unknown): MainTabCloseButtonMode {
    return value === 'always' || value === 'active' || value === 'hidden' ? value : 'hover';
}
export const MAIN_TAB_ICONS = Object.freeze(Object.entries(iconLabels).map(([id, label]) =>
    Object.freeze({ id: id as MainTabIcon, label })));

/** Main workspace-tab decoration, separate from pane content and launch preferences. */
export interface MainTabPresentation {
    version: typeof MAIN_TAB_PRESENTATION_VERSION;
    pinned?: true;
    /** Missing inherits the resource icon; `none` hides only this decorative icon. */
    icon?: MainTabIcon;
    /** Opaque hex accent marker, never a replacement for status or security colors. */
    accent?: string;
    /** Missing inherits the app preference. Hidden affects only the strip's close button. */
    closeButton?: MainTabCloseButton;
}

export type MainTabPresentationAction =
    | { type: 'set-pinned'; pinned: boolean }
    | { type: 'set-icon'; icon: MainTabIcon | undefined }
    | { type: 'set-accent'; accent: string | undefined }
    | { type: 'set-close-button'; closeButton: MainTabCloseButton | undefined }
    | { type: 'reset-appearance' };

type PresentedTab = { presentation?: MainTabPresentation };
type MainTabPresentationResult =
    | { ok: true; value: MainTabPresentation | undefined }
    | { ok: false };

const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isIcon = (value: unknown): value is MainTabIcon => typeof value === 'string' && hasOwn(iconLabels, value);
const isAccent = (value: unknown): value is string => typeof value === 'string' && value.length === 7 && /^#[\da-f]{6}$/i.test(value);
const isCloseButton = (value: unknown): value is MainTabCloseButton => value === 'always' || value === 'active' || value === 'hidden';

/** Migrate pin-only v1 metadata; reject unknown fields rather than silently downgrading them. */
export function parseMainTabPresentation(raw: unknown): MainTabPresentationResult {
    if (raw === undefined) return { ok: true, value: undefined };
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };
    const value = raw as Record<string, unknown>;
    const pinned = hasOwn(value, 'pinned') ? value.pinned : undefined;
    const icon = hasOwn(value, 'icon') ? value.icon : undefined;
    const accent = hasOwn(value, 'accent') ? value.accent : undefined;
    const closeButton = hasOwn(value, 'closeButton') ? value.closeButton : undefined;
    const legacy = value.version === 1;
    if (!hasOwn(value, 'version') || (!legacy && value.version !== MAIN_TAB_PRESENTATION_VERSION)
        || Object.keys(value).some(key => !['version', 'pinned', ...(legacy ? [] : ['icon', 'accent', 'closeButton'])].includes(key))
        || (hasOwn(value, 'pinned') && typeof value.pinned !== 'boolean')
        || (hasOwn(value, 'icon') && !isIcon(value.icon))
        || (hasOwn(value, 'accent') && !isAccent(value.accent))
        || (hasOwn(value, 'closeButton') && !isCloseButton(value.closeButton))) return { ok: false };
    const normalized: MainTabPresentation = {
        version: MAIN_TAB_PRESENTATION_VERSION,
        ...(pinned === true && { pinned: true }),
        ...(isIcon(icon) && { icon }),
        ...(isAccent(accent) && { accent: accent.toLowerCase() }),
        ...(isCloseButton(closeButton) && { closeButton }),
    };
    return { ok: true, value: Object.keys(normalized).length === 1 ? undefined : normalized };
}

/** Change one display preference without losing other decoration or clearing unknown data. */
export function changeMainTabPresentation(raw: unknown, action: MainTabPresentationAction):
    | { ok: true; value: MainTabPresentation | undefined; changed: boolean }
    | { ok: false } {
    const current = parseMainTabPresentation(raw);
    if (!current.ok || !action || typeof action !== 'object' || Array.isArray(action)) return { ok: false };
    const next: MainTabPresentation = { ...current.value, version: MAIN_TAB_PRESENTATION_VERSION };
    let field: 'pinned' | 'icon' | 'accent' | 'closeButton' | undefined;
    switch (action.type) {
        case 'set-pinned':
            if (typeof action.pinned !== 'boolean') return { ok: false };
            field = 'pinned';
            if (action.pinned) next.pinned = true; else delete next.pinned;
            break;
        case 'set-icon':
            if (action.icon !== undefined && !isIcon(action.icon)) return { ok: false };
            field = 'icon';
            if (action.icon === undefined) delete next.icon; else next.icon = action.icon;
            break;
        case 'set-accent':
            if (action.accent !== undefined && !isAccent(action.accent)) return { ok: false };
            field = 'accent';
            if (action.accent === undefined) delete next.accent; else next.accent = action.accent.toLowerCase();
            break;
        case 'set-close-button':
            if (action.closeButton !== undefined && !isCloseButton(action.closeButton)) return { ok: false };
            field = 'closeButton';
            if (action.closeButton === undefined) delete next.closeButton; else next.closeButton = action.closeButton;
            break;
        case 'reset-appearance':
            delete next.icon; delete next.accent; delete next.closeButton;
            break;
        default: return { ok: false };
    }
    if (!hasOwn(action, 'type') || (field && !hasOwn(action, field))
        || Object.keys(action).some(key => key !== 'type' && key !== field)) return { ok: false };
    const result = parseMainTabPresentation(next);
    if (!result.ok) return result;
    return { ...result, changed: JSON.stringify(current.value) !== JSON.stringify(result.value) };
}

/** Validate before restoration/filtering can drop a newer tab's unknown metadata. */
export function assertSupportedMainTabPresentations(tabs: unknown): void {
    if (!Array.isArray(tabs)) return;
    for (const tab of tabs) {
        if (tab !== null && typeof tab === 'object' && !Array.isArray(tab)
            && !parseMainTabPresentation(tab.presentation).ok) {
            throw new Error('SESSION_UNSUPPORTED_VERSION: unsupported main tab presentation metadata');
        }
    }
}

export function isMainTabPinned(tab: PresentedTab): boolean {
    return tab.presentation?.pinned === true;
}

/** Stable partition only: item identities and relative order within each bucket survive. */
export function stablePinnedMainTabs<T extends PresentedTab>(tabs: T[]): T[] {
    const ordered = [...tabs.filter(isMainTabPinned), ...tabs.filter(tab => !isMainTabPinned(tab))];
    return ordered.every((tab, index) => tab === tabs[index]) ? tabs : ordered;
}

/** Pointer and keyboard movement share the same stable-ID, same-pin-bucket operation. */
export function reorderMainTabsById<T extends PresentedTab & { id: string }>(tabs: T[], sourceId: string, targetId: string): T[] {
    const source = tabs.find(tab => tab.id === sourceId);
    const target = tabs.find(tab => tab.id === targetId);
    if (!source || !target || isMainTabPinned(source) !== isMainTabPinned(target)) return tabs;
    return reorderItemsById(tabs, sourceId, targetId);
}
