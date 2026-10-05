import { useId, useSyncExternalStore } from 'react';
import { Keyboard } from 'lucide-react';
import { TerminalShortcutMenu } from './TerminalShortcutMenu';
import { normalizeKeyboardSettings, normalizeTerminalFocusPolicy, TERMINAL_SHORTCUT_EXCEPTION_IDS, type KeyboardSettings } from '../../../features/shortcuts/policy';
import { SHORTCUT_CATALOG } from '../../../features/shortcuts/catalog';
import { formatShortcutLabel } from '../../../lib/shortcuts';
import { useAppStore } from '../../../store/useAppStore';
import { Select } from '../../ui/Select';

// All mounted controls share the in-flight write, not a second preference.
let saving = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};
const getSaving = () => saving;
function setSaving(value: boolean): void {
    saving = value;
    listeners.forEach(listener => listener());
}

/** One global preference and save boundary for menu, quick settings, and Settings. */
export function TerminalShortcutControl({ compact = false, showExceptions = false, menu = false }: { compact?: boolean; showExceptions?: boolean; menu?: boolean }) {
    const controlId = useId();
    const descriptionId = useId();
    const rawKeyboard = useAppStore(state => state.settings.keyboard);
    const keyboard = normalizeKeyboardSettings(rawKeyboard);
    const enabled = keyboard.terminalFocusPolicy === 'app';
    const pending = useSyncExternalStore(subscribe, getSaving, getSaving);
    const save = async (updates: Partial<KeyboardSettings>) => {
        if (saving) return;
        setSaving(true);
        try {
            await useAppStore.getState().updateKeyboardSettings(updates);
        } catch {
            useAppStore.getState().showToast('error', 'Could not save terminal shortcut preference. Please try again.');
        } finally {
            setSaving(false);
        }
    };
    const choices = SHORTCUT_CATALOG.filter(command => TERMINAL_SHORTCUT_EXCEPTION_IDS.some(id => id === command.id));
    const reserved = choices.filter(command => keyboard.terminalShortcutExceptions.includes(command.id));
    const reservation = reserved.length
        ? `Kept for Zync: ${reserved.map(command => `${formatShortcutLabel(command.defaultKeys)} (${command.label})`).join(', ')}.`
        : 'No app shortcuts are reserved.';
    const description = enabled
        ? 'Zync shortcuts take priority in the focused terminal.'
        : 'Terminal keys take priority. Selected Zync shortcuts and terminal copy/paste remain available.';
    if (menu) {
        return <TerminalShortcutMenu value={keyboard.terminalFocusPolicy} pending={pending}
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
            {!compact && (
                showExceptions ? (
                    <details className="pt-1">
                        <summary className="cursor-pointer text-xs font-medium text-app-text">Customize terminal-first shortcuts</summary>
                        <fieldset disabled={pending || enabled} className="mt-2 space-y-2 disabled:opacity-60">
                            <legend className="sr-only">Zync shortcut exceptions</legend>
                            <p className="text-xs text-app-muted">Keep the checked shortcuts for Zync. Uncheck all to pass app shortcuts to the terminal; terminal copy/paste remain available. Choose Terminal first to edit.</p>
                            {choices.map(command => (
                                <label key={command.id} className="flex flex-wrap items-center gap-2 text-xs text-app-text">
                                    <input
                                        type="checkbox"
                                        checked={keyboard.terminalShortcutExceptions.includes(command.id)}
                                        onChange={event => {
                                            const current = normalizeKeyboardSettings(useAppStore.getState().settings.keyboard).terminalShortcutExceptions;
                                            void save({ terminalShortcutExceptions: event.target.checked
                                                ? [...current, command.id] : current.filter(id => id !== command.id) });
                                        }}
                                    />
                                    <span>{command.label}</span>
                                    <span className="ml-auto break-words text-app-muted">{[command.defaultKeys, ...(command.extraKeys ?? [])].map(chord => formatShortcutLabel(chord)).join(' / ')}</span>
                                </label>
                            ))}
                        </fieldset>
                    </details>
                ) : <p className="text-[10px] text-app-muted">Choose exceptions in Settings → Shortcuts.</p>
            )}
        </div>
    );
}
