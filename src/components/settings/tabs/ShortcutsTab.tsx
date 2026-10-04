import { defaultSettings, type AppSettings } from '../../../store/settingsSlice';
import { useAppStore } from '../../../store/useAppStore';
import {
    SHORTCUT_SECTIONS,
    catalogBySection,
} from '../../../features/shortcuts';
import { KeybindingRow } from '../common/KeybindingRow';
import { Section } from '../common/Section';
import { TerminalShortcutControl } from '../common/TerminalShortcutControl';

interface ShortcutsTabProps {
    settings: AppSettings;
    updateKeybindings: (updates: Partial<AppSettings['keybindings']>) => Promise<void>;
}

export function ShortcutsTab({ settings, updateKeybindings }: ShortcutsTabProps) {
    const showToast = useAppStore((state) => state.showToast);
    const keybindings = settings.keybindings ?? defaultSettings.keybindings;
    const handleKeybindingChange = (updates: Partial<AppSettings['keybindings']>) => {
        void updateKeybindings(updates).catch((error) => {
            console.error('Failed to update keybinding', error);
            const message = error instanceof Error ? error.message : String(error);
            showToast('error', `Failed to save keybinding: ${message}`);
        });
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-300">
            <Section title="When a terminal is focused">
                <TerminalShortcutControl showExceptions />
            </Section>
            {SHORTCUT_SECTIONS.map((section) => {
                const rows = catalogBySection(section.id);
                if (rows.length === 0) return null;
                return (
                    <Section key={section.id} title={section.title}>
                        <div className="space-y-2">
                            {rows.map((row) => (
                                <KeybindingRow
                                    key={row.id}
                                    label={row.label}
                                    binding={keybindings[row.settingsKey!]}
                                    onChange={(val) => handleKeybindingChange({ [row.settingsKey!]: val })}
                                />
                            ))}
                        </div>
                    </Section>
                );
            })}
        </div>
    );
}
