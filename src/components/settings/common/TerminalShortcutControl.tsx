import { useId } from 'react';
import { Keyboard } from 'lucide-react';
import { TerminalShortcutMenu } from './TerminalShortcutMenu';
import { normalizeTerminalFocusPolicy } from '../../../features/shortcuts/policy';
import { SHORTCUT_CATALOG } from '../../../features/shortcuts/catalog';
import { activeShortcutBindingLabel, resolveShortcutBindings } from '../../../features/shortcuts/bindings';
import { useKeyboardShortcutSettings } from './useKeyboardShortcutSettings';
import { useAppStore } from '../../../store/useAppStore';
import { Select } from '../../ui/Select';

/** One global preference and save boundary for menu, quick settings, and Settings. */
export function TerminalShortcutControl({ compact = false, showExceptions = false, menu = false, showHelp = true, onManage }: { compact?: boolean; showExceptions?: boolean; menu?: boolean; showHelp?: boolean; onManage?: () => void }) {
    const controlId = useId();
    const descriptionId = useId();
    const { keyboard, pending, save, reserve } = useKeyboardShortcutSettings();
    const overrides = useAppStore(state => state.settings.keybindings) ?? {};
    const enabled = keyboard.terminalFocusPolicy === 'app';
    const choices = SHORTCUT_CATALOG.filter(command => command.terminalReservation);
    const reserved = choices.filter(command => keyboard.terminalShortcutExceptions.includes(command.id)
        && resolveShortcutBindings(command, overrides, SHORTCUT_CATALOG).active.length > 0);
    const reservation = reserved.length
        ? `Kept for Zync: ${reserved.map(command => `${activeShortcutBindingLabel(command, overrides, SHORTCUT_CATALOG)} (${command.label})`).join(', ')}.`
        : 'No app shortcuts are reserved.';
    const description = enabled
        ? 'Zync shortcuts take priority in the focused terminal.'
        : 'Terminal keys take priority. Selected Zync shortcuts and terminal copy/paste remain available.';
    if (menu) {
        return <TerminalShortcutMenu value={keyboard.terminalFocusPolicy} pending={pending} onManage={onManage}
            onChange={value => { void save({ terminalFocusPolicy: value }); }} />;
    }
    return (
        <div data-zync-shortcuts="local" className={compact ? 'space-y-1 px-2 py-2' : 'space-y-2 px-3 py-3'}>
            <label htmlFor={controlId} className="flex items-center gap-2 text-xs font-medium text-app-text">
                <Keyboard size={14} aria-hidden="true" />
                Keyboard shortcuts
            </label>
            <Select
                id={controlId}
                ariaLabel="Keyboard shortcuts"
                ariaDescribedBy={descriptionId}
                disabled={pending}
                value={keyboard.terminalFocusPolicy}
                onChange={value => { void save({ terminalFocusPolicy: normalizeTerminalFocusPolicy(value) }); }}
                title={`${description} ${reservation}`}
                showSearch={false}
                portal
                triggerClassName="min-w-0 rounded-lg px-2.5 py-2 text-xs focus-visible:ring-2 focus-visible:ring-app-accent"
                options={[
                    { value: 'shell', label: 'Terminal first', description: 'Recommended' },
                    { value: 'app', label: 'Zync first', description: 'App shortcuts take priority' },
                ]}
            />
            <p id={descriptionId} className={compact ? 'sr-only' : 'text-xs text-app-muted'}>{description}</p>
            {pending && <p role="status" className="text-xs text-app-muted">Saving…</p>}
            {!compact && showHelp && (
                showExceptions ? (
                    <details className="pt-1">
                        <summary className="cursor-pointer text-xs font-medium text-app-text">Customize terminal-first shortcuts</summary>
                        <fieldset disabled={pending || enabled} className="mt-2 space-y-2 disabled:opacity-60">
                            <legend className="sr-only">Zync shortcut exceptions</legend>
                            <p className="text-xs text-app-muted">Keep the checked shortcuts for Zync. Uncheck all to pass app shortcuts to the terminal; terminal copy/paste remain available. Choose Terminal first to edit.</p>
                            {choices.map(command => {
                                const active = resolveShortcutBindings(command, overrides, SHORTCUT_CATALOG).active.length > 0;
                                return (
                                    <label key={command.id} className="flex flex-wrap items-center gap-2 text-xs text-app-text">
                                        <input
                                            type="checkbox"
                                            checked={active && keyboard.terminalShortcutExceptions.includes(command.id)}
                                            disabled={!active}
                                            onChange={event => { void reserve(command.id, event.target.checked); }}
                                        />
                                        <span>{command.label}</span>
                                        <span className="ml-auto break-words text-app-muted">{activeShortcutBindingLabel(command, overrides, SHORTCUT_CATALOG)}</span>
                                    </label>
                                );
                            })}
                        </fieldset>
                    </details>
                ) : <p className="text-[10px] text-app-muted">Choose exceptions in Settings → Shortcuts.</p>
            )}
        </div>
    );
}
