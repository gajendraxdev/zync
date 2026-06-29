import type { FocusEvent } from 'react';
import type { AppSettings } from '../../../../store/settingsSlice';
import { Section } from '../../common/Section';

export interface AppearanceAccentSectionProps {
    settings: AppSettings;
    themeAccent: string;
    tempAccentColor: string;
    onTempAccentColorChange: (color: string) => void;
    onSelectPresetAccent: (color: string | null) => void;
    onCommitAccentColor: () => void;
    onColorInputBlur: (event: FocusEvent<HTMLInputElement>) => void;
}

const PRESET_ACCENT_COLORS = ['#6366f1', '#0969da', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'] as const;

export function AppearanceAccentSection({
    settings,
    themeAccent,
    tempAccentColor,
    onTempAccentColorChange,
    onSelectPresetAccent,
    onCommitAccentColor,
    onColorInputBlur,
}: AppearanceAccentSectionProps) {
    return (
        <Section title="Accent">
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-[var(--color-app-text)] opacity-80">Accent Color</label>
                        {!settings.accentColor && (
                            <span className="text-[10px] bg-[var(--color-app-accent)]/10 text-[var(--color-app-accent)] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-tighter border border-[var(--color-app-accent)]/20">
                                Theme Default
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2 flex-wrap" role="group" aria-label="Accent color presets">
                        <button
                            onClick={() => { onSelectPresetAccent(null); }}
                            className={`w-8 h-8 rounded-full border-2 transition-all relative ${!settings.accentColor
                                ? 'border-[var(--color-app-text)] scale-110 shadow-lg shadow-[var(--color-app-accent)]/20'
                                : 'border-transparent hover:scale-110'
                                }`}
                            title="Theme Default"
                            aria-label="Use theme default accent color"
                            aria-pressed={!settings.accentColor}
                            type="button"
                        >
                            <div className="absolute inset-0.5 rounded-full" style={{ backgroundColor: themeAccent }} />
                        </button>

                        {PRESET_ACCENT_COLORS.map((color) => (
                            <button
                                key={color}
                                onClick={() => { onSelectPresetAccent(color); }}
                                className={`w-8 h-8 rounded-full border-2 transition-all ${settings.accentColor === color
                                    ? 'border-[var(--color-app-text)] scale-110'
                                    : 'border-transparent hover:scale-110'
                                    }`}
                                style={{ backgroundColor: color }}
                                title={`Accent ${color}`}
                                aria-label={`Select accent color ${color}`}
                                aria-pressed={settings.accentColor === color}
                                type="button"
                            />
                        ))}
                        <input
                            type="color"
                            value={tempAccentColor}
                            onChange={(e) => { onTempAccentColorChange(e.target.value); }}
                            onBlur={onColorInputBlur}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    onCommitAccentColor();
                                }
                            }}
                            className="w-8 h-8 rounded-lg overflow-hidden border-0 p-0 cursor-pointer"
                            title="Custom accent color"
                            aria-label="Choose custom accent color"
                        />
                    </div>
                </div>
            </div>
        </Section>
    );
}