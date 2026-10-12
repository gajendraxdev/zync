import { Command } from 'cmdk';
import { PanelsTopLeft } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { SHORTCUT_CATALOG } from '../../features/shortcuts/catalog';
import { runShortcutCommand } from '../../features/shortcuts/actions';
import { workspacePresentationTarget } from '../../features/shortcuts/workspacePresentation';
import { formatShortcutLabel } from '../../lib/shortcuts';
import { useAppStore } from '../../store/useAppStore';

/** Palette adapter for registered workspace actions; labels and bindings have one owner. */
export function WorkspaceCommandItems({ runCommand }: { runCommand: (run: () => void) => void }) {
    const state = useAppStore(useShallow(store => ({
        tabs: store.tabs, activeTabId: store.activeTabId, terminals: store.terminals,
        paneLayouts: store.paneLayouts, contentPresentation: store.contentPresentation,
        sessionLoaded: store.sessionLoaded, isRestoring: store.isRestoring,
        sessionPersistenceBlocked: store.sessionPersistenceBlocked, keybindings: store.settings.keybindings,
    })));
    const commands = SHORTCUT_CATALOG.filter(command => command.shellAction === 'customize-navigation' || (command.workspaceAction
        && workspacePresentationTarget(command.workspaceAction, state)));
    if (commands.length === 0) return null;
    return <Command.Group heading="Workspace" className="mb-1 mt-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-app-muted">
        {commands.map(command => {
            const binding = command.settingsKey ? state.keybindings?.[command.settingsKey] ?? command.defaultKeys : command.defaultKeys;
            return <Command.Item key={command.id} value={command.label}
                onSelect={() => {
                    const expectedTabId = state.activeTabId;
                    runCommand(() => {
                        if (command.shellAction || useAppStore.getState().activeTabId === expectedTabId) {
                            runShortcutCommand(command.id, new KeyboardEvent('keydown'));
                        }
                    });
                }}
                className="relative mb-0.5 flex cursor-pointer select-none items-center rounded-lg px-2 py-1.5 text-sm normal-case tracking-normal text-app-text outline-none transition-colors data-[selected=true]:bg-app-accent/20 data-[selected=true]:text-app-accent">
                <PanelsTopLeft className="mr-2 h-4 w-4 opacity-70" aria-hidden="true" />
                <span>{command.label}</span>
                {binding && <span className="ml-auto text-[10px] opacity-50">{formatShortcutLabel(binding)}</span>}
            </Command.Item>;
        })}
    </Command.Group>;
}
