import catalog from './chromeActionCatalog.json' with { type: 'json' };
import { reorderItemsById } from './presentation';

export const CHROME_ACTION_AREAS = ['workspaceToolbar', 'statusBar'] as const;
export type ChromeActionArea = typeof CHROME_ACTION_AREAS[number];
export type ChromeActionId = keyof typeof catalog;
export interface ChromeActionPreferences {
    version: 1;
    workspaceToolbar: { order: ChromeActionId[]; hidden: ChromeActionId[] };
    statusBar: { order: ChromeActionId[]; hidden: ChromeActionId[] };
}
export type ChromeActionChange =
    | { type: 'hidden'; id: ChromeActionId; value: boolean }
    | { type: 'move'; id: ChromeActionId; targetId: ChromeActionId }
    | { type: 'reset'; area: ChromeActionArea };

/** Host-owned action registrations are presentation metadata, never command authority. */
export const CHROME_ACTIONS = Object.freeze((Object.keys(catalog) as ChromeActionId[]).map(id => Object.freeze({
    id, label: catalog[id].label, area: catalog[id].area as ChromeActionArea, optional: catalog[id].optional,
})));
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isId = (value: unknown): value is ChromeActionId => typeof value === 'string' && own(catalog, value);
const isArea = (value: unknown): value is ChromeActionArea => CHROME_ACTION_AREAS.some(area => area === value);
const defaults = (area: ChromeActionArea) => CHROME_ACTIONS.filter(action => action.area === area)
    .sort((left, right) => catalog[left.id].position - catalog[right.id].position).map(action => action.id);

/**
 * Missing preferences inherit today's registry; partial orders append new known items.
 * Unknown IDs, formats and attempts to hide protected indicators remain raw in storage
 * and render defaults. Both areas are bounded and cannot exchange actions.
 */
export function parseChromeActions(value: unknown): ChromeActionPreferences | null {
    if (value === undefined) return { version: 1,
        workspaceToolbar: { order: defaults('workspaceToolbar'), hidden: [] },
        statusBar: { order: defaults('statusBar'), hidden: [] } };
    if (!record(value) || Object.keys(value).length !== 3 || !own(value, 'version') || value.version !== 1) return null;
    const result = parseChromeActions(undefined)!;
    for (const area of CHROME_ACTION_AREAS) {
        const input = value[area];
        if (!own(value, area) || !record(input) || Object.keys(input).length !== 2 || !own(input, 'order') || !own(input, 'hidden')) return null;
        const allowed = defaults(area);
        const ids = (list: unknown): list is ChromeActionId[] => Array.isArray(list) && list.length <= allowed.length
            && list.every(id => isId(id) && allowed.includes(id)) && new Set(list).size === list.length;
        if (!ids(input.order) || !ids(input.hidden) || input.hidden.some(id => !catalog[id].optional)) return null;
        const savedOrder = input.order; const hidden = input.hidden;
        const order = [...savedOrder, ...allowed.filter(id => !savedOrder.includes(id))];
        result[area] = { order, hidden: order.filter(id => hidden.includes(id)) };
    }
    return result;
}

/** Copy and validate an intent before it enters the acknowledged save queue. */
export function prepareChromeActionChange(action: ChromeActionChange): ChromeActionChange | null {
    if (!record(action)) return null;
    if (action.type === 'reset') return isArea(action.area) ? { type: 'reset', area: action.area } : null;
    if (!isId(action.id)) return null;
    if (action.type === 'hidden') return catalog[action.id].optional && typeof action.value === 'boolean'
        ? { type: 'hidden', id: action.id, value: action.value } : null;
    if (action.type === 'move' && isId(action.targetId) && catalog[action.id].area === catalog[action.targetId].area) {
        return { type: 'move', id: action.id, targetId: action.targetId };
    }
    return null;
}

/** Reordering/hiding changes chrome only; feature availability and handlers stay with their owners. */
export function changeChromeActions(value: ChromeActionPreferences, change: ChromeActionChange): ChromeActionPreferences | null {
    const current = parseChromeActions(value); const action = prepareChromeActionChange(change);
    if (!current || !action) return null;
    if (action.type === 'reset') current[action.area] = { order: defaults(action.area), hidden: [] };
    else {
        const area = catalog[action.id].area as ChromeActionArea;
        const group = current[area];
        if (action.type === 'hidden') group.hidden = group.order.filter(id => id === action.id ? action.value : group.hidden.includes(id));
        else group.order = reorderItemsById(group.order.map(id => ({ id })), action.id, action.targetId).map(item => item.id);
    }
    return parseChromeActions(current);
}

/** Registered but currently unavailable actions remain dormant without losing their preference. */
export function visibleChromeActions(value: unknown, area: ChromeActionArea): ChromeActionId[] {
    const group = (parseChromeActions(value) ?? parseChromeActions(undefined)!)[area];
    return group.order.filter(id => !group.hidden.includes(id));
}
