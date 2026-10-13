import { CHROME_ACTIONS, parseChromeActions, type ChromeActionArea, type ChromeActionId } from '../../features/workspace/domain/chromeActions';
import type { ContextMenuItem } from '../ui/ContextMenu';

/** List configurable choices like Settings, retaining hidden/dormant actions for recovery. */
export function chromeVisibilityMenu(value: unknown, area: ChromeActionArea,
    onHidden: (id: ChromeActionId, hidden: boolean) => void, busy = false): ContextMenuItem[] {
    const parsed = parseChromeActions(value);
    const group = (parsed ?? parseChromeActions(undefined)!)[area];
    return group.order.map(id => CHROME_ACTIONS.find(entry => entry.id === id)!)
        .filter(action => action.optional).map(action => {
            const id = action.id;
            const visible = !group.hidden.includes(id);
            const disabled = busy || !parsed;
            return { label: action.label, checked: visible, disabled,
                action: () => { if (!disabled) onHidden(id, visible); } };
        });
}
