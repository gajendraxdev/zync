import type { AppSettings } from '../../../../store/settingsSlice';
import { Section } from '../../common/Section';
import { ColorPicker } from '../../../ui/ColorPicker';
import { Button } from '../../../ui/Button';
import { Tooltip } from '../../../ui/Tooltip';
import { normalizeHexColor } from './themeHelpers';

export interface AppearanceAccentSectionProps {
    settings: AppSettings;
    themeAccent: string;
    tempAccentColor: string;
    onTempAccentColorChange: (color: string) => void;
    onSelectPresetAccent: (color: string | null) => void;
    onCommitAccentColor: () => void;
}

const PRESET_ACCENT_COLORS = ['#6366f1', '#0969da', '#10b981', '#ef4444', '#f59e0b', '#8b5cf6', '#ec4899'] as const;

export function AppearanceAccentSection({
    settings,
    themeAccent,
    tempAccentColor,
    onTempAccentColorChange,
    onSelectPresetAccent,
    onCommitAccentColor,
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
                        <Tooltip content="Use the selected theme's default accent."><button
                            onClick={() => { onSelectPresetAccent(null); }}
                            className={`w-8 h-8 rounded-full border-2 transition-all relative ${!settings.accentColor
                                ? 'border-[var(--color-app-text)] scale-110 shadow-lg shadow-[var(--color-app-accent)]/20'
                                : 'border-transparent hover:scale-110'
                                }`}
                            aria-label="Use theme default accent color"
                            aria-pressed={!settings.accentColor}
                            type="button"
                        >
                            <div className="absolute inset-0.5 rounded-full" style={{ backgroundColor: themeAccent }} />
                        </button></Tooltip>

                        {PRESET_ACCENT_COLORS.map((color) => (
                            <Tooltip key={color} content={`Use accent ${color}.`}><button
                                onClick={() => { onSelectPresetAccent(color); }}
                                className={`w-8 h-8 rounded-full border-2 transition-all ${settings.accentColor === color
                                    ? 'border-[var(--color-app-text)] scale-110'
                                    : 'border-transparent hover:scale-110'
                                    }`}
                                style={{ backgroundColor: color }}
                                aria-label={`Select accent color ${color}`}
                                aria-pressed={settings.accentColor === color}
                                type="button"
                            /></Tooltip>
                        ))}
                        <ColorPicker label="Accent" value={tempAccentColor} referenceColor={themeAccent}
                            onChange={onTempAccentColorChange} className="h-auto min-h-8 whitespace-normal"
                            palette={[{ label: 'Theme default', color: themeAccent }]}>
                            <span aria-hidden="true" className="mr-2 h-4 w-4 shrink-0 rounded border border-app-border"
                                style={{ backgroundColor: normalizeHexColor(tempAccentColor) ?? themeAccent }} />Custom accent
                        </ColorPicker>
                        <Tooltip content="Save your custom accent draft. Closing the picker does not save it."
                            contentClassName="max-w-xs whitespace-normal" disabledTrigger={!normalizeHexColor(tempAccentColor)}>
                            <Button type="button" variant="secondary" disabled={!normalizeHexColor(tempAccentColor)}
                                onClick={onCommitAccentColor}>Apply accent</Button>
                        </Tooltip>
                    </div>
                </div>
                <p className="text-xs text-app-muted">Presets save directly. Custom colors stay a draft until you apply the accent.</p>
            </div>
        </Section>
    );
}
