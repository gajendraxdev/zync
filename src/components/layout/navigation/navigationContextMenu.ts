import type { ContextMenuItem } from '../../ui/ContextMenu';
import { shortcutHint } from '../../../features/shortcuts/labels';
import { navigationOrder, type NavigationChange, type NavigationId, type WorkspaceNavigation } from '../../../features/workspace/domain/navigation';
import type { NavigationEntry } from './navigationItems';

/** Presentation-only menu. Every mutation goes through the existing acknowledged preference port. */
export function navigationContextMenu({ preferences, entries, keybindings, selectedId, editable, onChange, onCustomize }: {
    preferences: WorkspaceNavigation;
    entries: readonly NavigationEntry[];
    keybindings: Readonly<Record<string, string | undefined>>;
    selectedId?: NavigationId;
    editable: boolean;
    onChange: (action: NavigationChange) => void;
    onCustomize: () => void;
}): ContextMenuItem[] {
    const registered = navigationOrder(preferences, entries.map(entry => entry.id))
        .filter(id => id !== 'settings' && id !== 'profile' && (id !== 'workspace' || preferences.workspaceTabsPosition !== 'default'))
        .map(id => entries.find(entry => entry.id === id)).filter((entry): entry is NavigationEntry => Boolean(entry));
    const visible = registered.filter(entry => !preferences.hidden.includes(entry.id));
    const selectedIndex = visible.findIndex(entry => entry.id === selectedId);
    return [
        ...registered.map(entry => ({
            label: entry.label,
            checked: !preferences.hidden.includes(entry.id),
            shortcut: shortcutHint(entry.shortcutId ?? (entry.action.kind === 'command' ? entry.action.commandId : ''), keybindings),
            disabled: !editable,
            action: () => onChange({ type: 'hidden', id: entry.id, value: !preferences.hidden.includes(entry.id) }),
        })),
        { separator: true },
        // Required recovery actions stay in the footer, even when all optional items are hidden.
        { label: 'Settings', checked: true, disabled: true, shortcut: shortcutHint('toggleSettings', keybindings), action: () => {} },
        { label: 'Profile', checked: true, disabled: true, shortcut: shortcutHint('navigationProfile', keybindings), action: () => {} },
        { separator: true },
        ...(selectedId && selectedIndex >= 0 ? [{ label: 'Arrange item', children: [
            { label: 'Move earlier', disabled: !editable || selectedIndex <= 0,
                action: () => { const target = visible[selectedIndex - 1]; if (target) onChange({ type: 'move', id: selectedId, targetId: target.id }); } },
            { label: 'Move later', disabled: !editable || selectedIndex === visible.length - 1,
                action: () => { const target = visible[selectedIndex + 1]; if (target) onChange({ type: 'move', id: selectedId, targetId: target.id }); } },
        ] }] : []),
        { label: 'Navigation position', disabled: !editable, children: (['left', 'right'] as const).map(position => ({
            label: position === 'left' ? 'Left' : 'Right', checked: preferences.position === position, checkType: 'radio' as const,
            action: () => onChange({ type: 'position', value: position }),
        })) },
        { label: 'Hide navigation bar', disabled: !editable, action: () => onChange({ type: 'visible', value: false }) },
        { label: 'Customize navigation', action: onCustomize },
        { label: 'Reset navigation', disabled: !editable, action: () => onChange({ type: 'reset' }) },
    ];
}
