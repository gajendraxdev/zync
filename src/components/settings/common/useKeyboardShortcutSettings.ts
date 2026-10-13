import { useSyncExternalStore } from 'react';
import { normalizeKeyboardSettings, type KeyboardSettings } from '../../../features/shortcuts/policy';
import { useAppStore } from '../../../store/useAppStore';

// All mounted controls share the in-flight write, not a second preference.
let saving = false;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const getSaving = () => saving;
function setSaving(value: boolean): void {
    saving = value;
    listeners.forEach(listener => listener());
}

/** Shared preference/save boundary for Settings, sidebar and quick controls. */
export function useKeyboardShortcutSettings() {
    const rawKeyboard = useAppStore(state => state.settings.keyboard);
    const keyboard = normalizeKeyboardSettings(rawKeyboard);
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
    const reserve = (id: string, checked: boolean) => {
        const current = normalizeKeyboardSettings(useAppStore.getState().settings.keyboard).terminalShortcutExceptions;
        return save({ terminalShortcutExceptions: checked ? [...current, id] : current.filter(item => item !== id) });
    };
    return { keyboard, pending, save, reserve };
}
