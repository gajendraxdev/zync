import type { ContextMenuItem } from '../../ui/ContextMenu';
import type { WorkspaceTabsPosition } from '../../../features/workspace/domain/navigation';

/** Pointer, keyboard and strip context menus use the same acknowledged placement action. */
export function workspaceTabsMenu(position: WorkspaceTabsPosition,
    change: (position: WorkspaceTabsPosition) => void, disabled = false): ContextMenuItem[] {
    return (['default', 'left', 'right'] as const).map(value => ({
        label: value === 'default' ? 'Current position' : value === 'left' ? 'Left sidebar' : 'Right sidebar',
        checked: position === value, checkType: 'radio', disabled,
        action: () => change(value),
    }));
}
