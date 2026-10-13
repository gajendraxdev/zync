import type { AppSettings } from '../../store/settingsSlice';
import type { GlobalNavigationAction } from '../workspace/application/globalNavigation';

export type KeyboardFocus = 'xterm' | 'field' | 'app';

/** Closed set — see docs/SHORTCUTS.md §5. */
export type ShortcutWhen = 'always' | 'xterm' | 'app' | 'field' | 'files';

export type ShortcutSection = 'global' | 'tabs' | 'terminal' | 'view' | 'files' | 'hidden';

export type KeybindingId = keyof AppSettings['keybindings'];

/** Host presentation actions; these do not grant plugin bridge authority. */
export type WorkspacePresentationAction = 'customize-tab' | 'contents' | 'reveal-all' | 'maximize-pane';

export type ShortcutCommand = {
    id: string;
    label: string;
    section: ShortcutSection;
    defaultKeys: string;
    /** Fixed alternate chords, shown in Settings; disabling the command disables these too. */
    extraKeys?: readonly string[];
    when: ShortcutWhen;
    /** User override in settings.keybindings. Omit for non-configurable chords. */
    settingsKey?: KeybindingId;
    configurable: boolean;
    /** Independently editable alternate binding; dispatches the existing action once. */
    actionId?: string;
    /** Host copy/paste only: stays available in terminal-first mode. */
    terminalUtility?: boolean;
    /** Catalog-owned terminal reservation eligibility; defaults never override saved choices. */
    terminalReservation?: 'optional' | 'recommended' | 'default';
    /** Directional actions need an arrow key even when modifiers are remapped. */
    keyConstraint?: 'arrow';
    /** Held keys must not repeat toggles or destructive actions by default. */
    repeatable?: boolean;
    /** Declarative handler shared by the catalog, palette and shortcut dispatcher. */
    workspaceAction?: WorkspacePresentationAction;
    /** Global shell preferences remain reachable without an active workspace. */
    shellAction?: 'customize-navigation' | 'profile-menu';
    /** Use the same global destination controller as the activity bar. */
    navigationAction?: GlobalNavigationAction;
};
