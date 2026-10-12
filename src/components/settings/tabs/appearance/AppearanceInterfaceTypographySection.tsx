import type { AppSettings } from '../../../../store/settingsSlice';
import { Button } from '../../../ui/Button';
import { Select } from '../../../ui/Select';
import { Toolbar } from '../../../ui/Toolbar';
import { Section } from '../../common/Section';
import { DEFAULT_GLOBAL_FONT_STACK } from '../../constants/defaults';
import { FontStackField } from '../../common/FontStackField';

const GLOBAL_FONT_SIZE_MIN = 10;
const GLOBAL_FONT_SIZE_MAX = 24;

const BASE_FONT_OPTIONS = [
    {
        value: DEFAULT_GLOBAL_FONT_STACK,
        label: 'System UI (Recommended)',
        description: 'Best cross-platform default using built-in system fonts',
    },
    {
        value: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
        label: 'Inter',
        description: 'Inter first, then system fallback',
    },
    {
        value: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
        label: 'Segoe UI',
        description: 'Windows-native UI style',
    },
    {
        value: "'SF Pro Text', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif",
        label: 'SF Pro / Apple',
        description: 'Apple-style UI fallback stack',
    },
] as const;

export interface AppearanceInterfaceTypographySectionProps {
    settings: AppSettings;
    globalFontDraft: string;
    draftGlobalFontSize: number;
    onGlobalFontDraftChange: (value: string) => void;
    onApplyCustomFont: () => void;
    onGlobalFontFamilyChange: (value: string) => void;
    onDraftGlobalFontSizeChange: (value: number) => void;
    onCommitGlobalFontSize: () => void;
    onResetTypography: () => void;
}

export function AppearanceInterfaceTypographySection({
    settings,
    globalFontDraft,
    draftGlobalFontSize,
    onGlobalFontDraftChange,
    onApplyCustomFont,
    onGlobalFontFamilyChange,
    onDraftGlobalFontSizeChange,
    onCommitGlobalFontSize,
    onResetTypography,
}: AppearanceInterfaceTypographySectionProps) {
    const hasMatchingFontOption = BASE_FONT_OPTIONS.some((option) => option.value === settings.globalFontFamily);
    const fontOptions = hasMatchingFontOption
        ? [...BASE_FONT_OPTIONS]
        : [
            {
                value: settings.globalFontFamily,
                label: 'Custom',
                description: settings.globalFontFamily,
            },
            ...BASE_FONT_OPTIONS,
        ];

    return (
        <Section title="Interface typography">
            <div className="space-y-4 rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/40 p-4">
                <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
                    Menus, sidebar, and panel text only. Switch to the Terminal tab above for monospace font settings.
                </p>
                <Select
                    label="Global UI Font"
                    value={settings.globalFontFamily}
                    onChange={onGlobalFontFamilyChange}
                    options={fontOptions}
                    triggerClassName="bg-app-bg/50"
                />

                <FontStackField
                    label="Custom UI Font Stack"
                    value={globalFontDraft}
                    onChange={onGlobalFontDraftChange}
                    onApply={onApplyCustomFont}
                    placeholder="e.g. 'IBM Plex Sans', 'Segoe UI', sans-serif"
                />

                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label htmlFor="global-font-size-slider" className="text-sm font-medium text-[var(--color-app-text)]">Global Font Size</label>
                        <span className="text-sm text-[var(--color-app-accent)] font-mono">{draftGlobalFontSize}px</span>
                    </div>
                    <input
                        id="global-font-size-slider"
                        type="range"
                        min={GLOBAL_FONT_SIZE_MIN}
                        max={GLOBAL_FONT_SIZE_MAX}
                        step="1"
                        aria-valuetext={`${draftGlobalFontSize} pixels`}
                        aria-describedby="global-font-size-help"
                        className="w-full accent-[var(--color-app-accent)] h-2 bg-[var(--color-app-surface)] rounded-lg appearance-none cursor-pointer"
                        value={draftGlobalFontSize}
                        onChange={(e) => {
                            const parsed = Number.parseInt(e.target.value, 10);
                            const clamped = Math.max(
                                GLOBAL_FONT_SIZE_MIN,
                                Math.min(GLOBAL_FONT_SIZE_MAX, Number.isFinite(parsed) ? parsed : GLOBAL_FONT_SIZE_MIN),
                            );
                            onDraftGlobalFontSizeChange(clamped);
                        }}
                        onPointerUp={onCommitGlobalFontSize}
                        onKeyUp={onCommitGlobalFontSize}
                        onBlur={onCommitGlobalFontSize}
                    />
                    <div id="global-font-size-help" className="text-[11px] text-[var(--color-app-muted)]">
                        Changes app-wide UI text scale (menus, panels, labels, buttons).
                    </div>
                </div>

                <div className="text-[11px] leading-relaxed text-[var(--color-app-muted)] rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/30 px-3 py-2.5">
                    Note: Global UI font/size applies across the app interface. If a custom font looks unchanged, confirm it is installed on your system.
                </div>

                <Toolbar label="Interface typography reset" className="justify-between rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/30 px-3 py-2.5">
                    <p className="min-w-0 flex-1 text-[11px] text-[var(--color-app-muted)]">
                        Reset global UI typography to recommended defaults.
                    </p>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={onResetTypography}
                        className="shrink-0"
                    >
                        Reset
                    </Button>
                </Toolbar>
            </div>
        </Section>
    );
}
