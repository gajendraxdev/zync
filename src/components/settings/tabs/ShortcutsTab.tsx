import { useState } from 'react';
import { defaultSettings, type AppSettings } from '../../../store/settingsSlice';
import { useAppStore } from '../../../store/useAppStore';
import { SHORTCUT_CATALOG, SHORTCUT_SECTIONS, type ShortcutCommand } from '../../../features/shortcuts';
import { shortcutBindings, shortcutBindingLabel, shortcutBindingIssue, shortcutBindingWarning, resolveShortcutBindings } from '../../../features/shortcuts/bindings';
import { RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS } from '../../../features/shortcuts/policy';
import { KeybindingRow } from '../common/KeybindingRow';
import { Section } from '../common/Section';
import { TerminalShortcutControl } from '../common/TerminalShortcutControl';
import { useKeyboardShortcutSettings } from '../common/useKeyboardShortcutSettings';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Toggle } from '../common/Toggle';

interface ShortcutsTabProps {
    settings: AppSettings;
    updateKeybindings: (updates: Partial<AppSettings['keybindings']>) => Promise<void>;
}

/** Catalog-driven editor; binding scope, aliases and terminal ownership share runtime policy. */
export function ShortcutsTab({ settings, updateKeybindings }: ShortcutsTabProps) {
    const showToast = useAppStore(state => state.showToast);
    const { keyboard, pending, save, reserve } = useKeyboardShortcutSettings();
    const [query, setQuery] = useState('');
    const bindingPending = useAppStore(state => state.pendingKeybindingWrites > 0);
    const keybindings = settings.keybindings ?? defaultSettings.keybindings;
    const appFirst = keyboard.terminalFocusPolicy === 'app';
    const locked = pending || bindingPending;

    const changeBinding = async (command: ShortcutCommand, value: string) => {
        if (!command.settingsKey || locked) return;
        try { await updateKeybindings({ [command.settingsKey]: value }); }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showToast('error', 'Failed to save keybinding: ' + message);
        }
    };
    const sections = [...SHORTCUT_SECTIONS, { id: 'hidden', title: 'Host features' }];
    const needle = query.trim().toLowerCase();
    const rowsFor = (section: string) => SHORTCUT_CATALOG.filter(command => command.section === section
        && (command.configurable || command.terminalReservation)
        && (command.label + ' ' + shortcutBindingLabel(command, keybindings)).toLowerCase().includes(needle));
    return <div className="space-y-6">
        <Section title="When a terminal is focused">
            <TerminalShortcutControl showHelp={false} />
            <p className="mb-2 text-xs text-app-muted">
                Available in terminal reserves a shortcut for Zync, including inside Vim, nano and tmux.
                Other keys stay with the terminal.
            </p>
            <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" disabled={locked || appFirst}
                    onClick={() => { void save({ terminalShortcutExceptions: [...RECOMMENDED_TERMINAL_SHORTCUT_EXCEPTIONS] }); }}>
                    Use recommended reservations
                </Button>
                <Button type="button" variant="secondary" size="sm" disabled={locked || appFirst}
                    onClick={() => { void save({ terminalShortcutExceptions: [] }); }}>Pass app shortcuts to terminal</Button>
            </div>
            <p className="mt-2 text-xs text-app-muted">The preset reserves navigation, tab and pane controls, Settings, host features, zoom and alternative bindings. Replaces reservations, not bindings. Plain Ctrl+B/P/I remain with the terminal. Terminal copy/paste stay available.</p>
        </Section>
        <Input label="Find a shortcut" placeholder="Search actions or keys…" value={query} onChange={event => setQuery(event.target.value)} />
        {bindingPending && <p role="status" className="text-xs text-app-muted">Saving shortcut…</p>}
        {sections.map(section => {
            const rows = rowsFor(section.id);
            return rows.length ? <Section key={section.id} title={section.title}>
                <div className="space-y-2">{rows.map(command => {
                    const reserved = keyboard.terminalShortcutExceptions.includes(command.id);
                    const keys = shortcutBindings(command, keybindings);
                    const activeKeys = resolveShortcutBindings(command, keybindings, SHORTCUT_CATALOG).active;
                    return <KeybindingRow key={command.id} label={command.label} binding={keys[0] ?? ''}
                        defaultBinding={command.defaultKeys} aliases={command.extraKeys?.filter(chord => activeKeys.includes(chord))} disabled={locked}
                        readOnly={!command.configurable} onChange={value => { void changeBinding(command, value); }}
                        validate={value => shortcutBindingIssue(command, value, keybindings, SHORTCUT_CATALOG)}
                        warning={shortcutBindingWarning(command, keybindings, SHORTCUT_CATALOG)}>
                        {command.actionId && <p className="text-xs text-app-muted">Same action as {SHORTCUT_CATALOG.find(row => row.id === command.actionId)?.label}; this binding and its terminal permission are independent.</p>}
                        {(command.id === 'toggleSidebar' || command.actionId === 'toggleSidebar') && <p className="text-xs text-app-muted">Toggles Hosts when navigation is visible; otherwise toggles the current sidebar.</p>}
                        {command.terminalReservation ? <Toggle label={'Available in terminal: ' + command.label}
                            checked={activeKeys.length > 0 && (appFirst || reserved)} disabled={locked || appFirst || !activeKeys.length}
                            onChange={checked => { void reserve(command.id, checked); }}
                            description={!keys.length ? 'Assign a shortcut first. Your reservation selection is retained.'
                                : !activeKeys.length ? 'Inactive because a custom shortcut takes priority. Your reservation selection is retained.'
                                : appFirst ? 'Zync first already prioritizes this command; your hybrid selection is retained.'
                                : reserved ? 'Reserved for Zync, including inside terminal editors. This overrides the same terminal key.'
                                : 'Passed to terminal while it is focused; available in the app when its context allows.'} />
                            : <p className="text-xs text-app-muted">{!keys.length ? 'No keyboard binding; visible app controls remain available.' : command.terminalUtility
                                ? 'Terminal clipboard utility; available whenever the terminal is focused.'
                                : 'File Manager only; does not send commands to a background terminal.'}</p>}
                    </KeybindingRow>;
                })}</div>
            </Section> : null;
        })}
        {!sections.some(section => rowsFor(section.id).length) && <p role="status" className="text-sm text-app-muted">No matching shortcuts.</p>}
    </div>;
}
