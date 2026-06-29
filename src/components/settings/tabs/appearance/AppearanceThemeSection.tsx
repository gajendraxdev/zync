import { Monitor } from 'lucide-react';
import type { MouseEvent } from 'react';
import type { AppSettings } from '../../../../store/settingsSlice';
import { Section } from '../../common/Section';
import {
    getThemeId,
    preventBlurBeforeClick,
    type ThemePlugin,
} from './themeHelpers';

interface ThemeButtonProps {
    plugin: ThemePlugin;
    isSelected: boolean;
    onClick: () => void;
    onMouseDown?: (event: MouseEvent) => void;
}

function SystemThemeSwatch() {
    return (
        <div className="w-12 h-12 rounded-lg shadow-inner flex items-center justify-center shrink-0 border border-[var(--color-app-border)] overflow-hidden relative">
            <div className="absolute inset-0 flex" aria-hidden>
                <div className="w-1/2 h-full bg-[#09090b]" />
                <div className="w-1/2 h-full bg-[#fafafa]" />
            </div>
            <div className="relative z-10 size-[18px]" aria-hidden>
                <Monitor
                    size={18}
                    className="absolute inset-0 text-white"
                    strokeWidth={2}
                    style={{ clipPath: 'polygon(0 0, 50% 0, 50% 100%, 0 100%)' }}
                />
                <Monitor
                    size={18}
                    className="absolute inset-0 text-[#09090b]"
                    strokeWidth={2}
                    style={{ clipPath: 'polygon(50% 0, 100% 0, 100% 100%, 50% 100%)' }}
                />
            </div>
        </div>
    );
}

function ThemeButton({ plugin, isSelected, onClick, onMouseDown }: ThemeButtonProps) {
    const themeId = getThemeId(plugin.manifest.id);
    const isLight = plugin.manifest.mode !== 'dark';

    const themeLabel = plugin.manifest.name.replace(' Theme', '');

    return (
        <button
            type="button"
            onMouseDown={onMouseDown}
            onClick={onClick}
            aria-pressed={isSelected}
            aria-label={`${themeLabel} theme`}
            className={`group p-4 rounded-xl border text-left flex items-center gap-4 transition-all relative overflow-hidden ${isSelected
                ? 'bg-[var(--color-app-bg)] border-[var(--color-app-accent)] ring-1 ring-[var(--color-app-accent)]'
                : 'bg-[var(--color-app-bg)]/40 border-[var(--color-app-border)] hover:bg-[var(--color-app-bg)]/60 hover:border-[var(--color-app-border)]'
                }`}
        >
            <div
                className={`w-12 h-12 rounded-lg shadow-inner flex items-center justify-center shrink-0 ${isLight ? 'border border-black/5' : 'border border-white/10'}`}
                style={{ background: plugin.manifest.preview_bg || (isLight ? '#ffffff' : '#000000') }}
            >
                <div
                    className="w-3 h-3 rounded-full shadow-sm"
                    style={{ backgroundColor: plugin.manifest.preview_accent || (isLight ? '#000000' : '#ffffff') }}
                />
            </div>
            <div>
                <div className="font-semibold text-[var(--color-app-text)] text-sm">
                    {plugin.manifest.name.replace(' Theme', '')}
                </div>
                <div className="text-xs text-[var(--color-app-muted)] mt-0.5">
                    {themeId === 'system' ? 'Auto-detect' : plugin.manifest.mode === 'dark' ? 'Dark' : 'Light'}
                </div>
            </div>
        </button>
    );
}

export interface AppearanceThemeSectionProps {
    sectionTitle?: string;
    settings: AppSettings;
    lightPlugins: ThemePlugin[];
    darkPlugins: ThemePlugin[];
    hint: string;
    onSelectTheme: (themeId: string) => void;
}

export function AppearanceThemeSection({
    sectionTitle = 'Theme',
    settings,
    lightPlugins,
    darkPlugins,
    hint,
    onSelectTheme,
}: AppearanceThemeSectionProps) {
    return (
        <Section title={sectionTitle}>
            <div className="space-y-6">
                <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)] pl-1">
                    {hint}
                </p>
                <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-[var(--color-app-muted)] uppercase tracking-wider pl-1">
                        System default
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        <button
                            type="button"
                            onMouseDown={preventBlurBeforeClick}
                            onClick={() => { onSelectTheme('system'); }}
                            aria-pressed={settings.theme === 'system'}
                            aria-label="System theme"
                            className={`group p-4 rounded-xl border text-left flex items-center gap-4 transition-all relative overflow-hidden ${settings.theme === 'system'
                                ? 'bg-[var(--color-app-bg)] border-[var(--color-app-accent)] ring-1 ring-[var(--color-app-accent)]'
                                : 'bg-[var(--color-app-bg)]/40 border-[var(--color-app-border)] hover:bg-[var(--color-app-bg)]/60 hover:border-[var(--color-app-border)]'
                                }`}
                        >
                            <SystemThemeSwatch />
                            <div>
                                <div className="font-semibold text-[var(--color-app-text)] text-sm">System</div>
                                <div className="text-xs text-[var(--color-app-muted)] mt-0.5">Auto-detect</div>
                            </div>
                        </button>
                    </div>
                </div>

                <div className="h-px bg-[var(--color-app-border)]/20 my-2" />

                <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-[var(--color-app-muted)] uppercase tracking-wider pl-1">
                        Light Themes
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        {lightPlugins.map((plugin) => (
                            <ThemeButton
                                key={plugin.manifest.id}
                                plugin={plugin}
                                isSelected={settings.theme === getThemeId(plugin.manifest.id)}
                                onMouseDown={preventBlurBeforeClick}
                                onClick={() => { onSelectTheme(getThemeId(plugin.manifest.id)); }}
                            />
                        ))}
                    </div>
                </div>

                <div className="h-px bg-[var(--color-app-border)]/20 my-2" />

                <div className="space-y-3">
                    <h4 className="text-xs font-semibold text-[var(--color-app-muted)] uppercase tracking-wider pl-1">
                        Dark Themes
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        {darkPlugins.map((plugin) => (
                            <ThemeButton
                                key={plugin.manifest.id}
                                plugin={plugin}
                                isSelected={settings.theme === getThemeId(plugin.manifest.id)}
                                onMouseDown={preventBlurBeforeClick}
                                onClick={() => { onSelectTheme(getThemeId(plugin.manifest.id)); }}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </Section>
    );
}