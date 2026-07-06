import { Terminal } from 'lucide-react';
import type { AppSettings } from '../../../store/settingsSlice';
import { Select } from '../../ui/Select';
import { Section } from '../common/Section';
import { Toggle } from '../common/Toggle';
import {
    DEFAULT_TERMINAL_GPU_ACCELERATION,
    DEFAULT_SUSPEND_IDLE_HOST_PTYS,
    DEFAULT_IDLE_HOST_PTY_SUSPEND_MINUTES,
} from '../constants/defaults';
import { TerminalRendererStatus } from './TerminalRendererStatus';
import { TerminalTabIntro } from './TerminalTabIntro';

interface TerminalTabProps {
    settings: AppSettings;
    wslDistros: string[];
    isWindows: boolean;
    onOpenAppearanceTerminal: () => void;
    onOpenAppearanceApp: () => void;
    updateTerminalSettings: (updates: Partial<AppSettings['terminal']>) => Promise<void>;
    updateLocalTermSettings: (updates: Partial<AppSettings['localTerm']>) => Promise<void>;
    setGhostSuggestionsField: (patch: Partial<AppSettings['ghostSuggestions']>) => void;
    setGhostProviderField: (patch: Partial<AppSettings['ghostSuggestions']['providers']>) => void;
}

export function TerminalTab({
    settings,
    wslDistros,
    isWindows,
    onOpenAppearanceTerminal,
    onOpenAppearanceApp,
    updateTerminalSettings,
    updateLocalTermSettings,
    setGhostSuggestionsField,
    setGhostProviderField,
}: TerminalTabProps) {
    return (
        <div className="space-y-6">
            <TerminalTabIntro
                onOpenAppearanceTerminal={onOpenAppearanceTerminal}
                onOpenAppearanceApp={onOpenAppearanceApp}
            />

            {isWindows && (
                <>
                    <Section title="Local shell (Windows)">
                        <div className="space-y-3">
                            <Select
                                label="Default Shell"
                                value={settings.localTerm?.windowsShell || 'default'}
                                onChange={(value) => { void updateLocalTermSettings({ windowsShell: value }); }}
                                options={[
                                    { value: 'default', label: 'Default', icon: <Terminal size={14} />, description: 'System Decision' },
                                    { value: 'powershell', label: 'PowerShell', icon: <Terminal size={14} /> },
                                    { value: 'cmd', label: 'Command Prompt', icon: <Terminal size={14} /> },
                                    { value: 'gitbash', label: 'Git Bash', icon: <Terminal size={14} /> },
                                    { value: 'wsl', label: 'WSL (Default)', icon: <Terminal size={14} /> },
                                    ...wslDistros.map((distro) => ({
                                        value: `wsl:${distro}`,
                                        label: `WSL: ${distro}`,
                                        icon: <Terminal size={14} />,
                                    })),
                                ]}
                                className="bg-app-bg/50"
                            />
                            <div className="text-[10px] text-[var(--color-app-muted)] pl-1">
                                Changes take effect on new split panes or tabs.
                            </div>
                        </div>
                    </Section>

                    <div className="h-px bg-[var(--color-app-border)]/20 my-2" />
                </>
            )}

            <Section title="Rendering">
                <div className="rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/40 p-3 space-y-3">
                    <Toggle
                        label="GPU Acceleration (WebGL)"
                        description="Faster rendering for large output. On Windows, GPU text is rasterized to a canvas and can look sharper/thinner than DOM mode, which uses native ClearType."
                        checked={settings.terminal.gpuAcceleration ?? DEFAULT_TERMINAL_GPU_ACCELERATION}
                        onChange={(value) => { void updateTerminalSettings({ gpuAcceleration: value }); }}
                    />
                    <TerminalRendererStatus
                        gpuAcceleration={settings.terminal.gpuAcceleration ?? DEFAULT_TERMINAL_GPU_ACCELERATION}
                    />
                </div>
            </Section>

            <div className="h-px bg-[var(--color-app-border)]/20 my-2" />

            <Section title="Background hosts">
                <div className="rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/40 p-3 space-y-3">
                    <Toggle
                        label="Suspend idle host shells"
                        description="After switching away from a workspace host, suspend its PTYs once quiet (scrollback preserved). Shells still producing output stay alive. Press Enter on return to resume. Off by default — SSH hosts show a fresh login on auto-respawn."
                        checked={settings.terminal.suspendIdleHostPtys ?? DEFAULT_SUSPEND_IDLE_HOST_PTYS}
                        onChange={(value) => { void updateTerminalSettings({ suspendIdleHostPtys: value }); }}
                    />
                    {(settings.terminal.suspendIdleHostPtys ?? DEFAULT_SUSPEND_IDLE_HOST_PTYS) && (
                        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/30 px-3 py-2.5">
                            <div>
                                <p id="idle-host-pty-timeout-label" className="text-sm font-medium text-[var(--color-app-text)]">Idle timeout</p>
                                <p className="text-[11px] text-[var(--color-app-muted)]">Minutes before background host PTYs suspend</p>
                            </div>
                            <input
                                type="number"
                                min={1}
                                max={60}
                                inputMode="numeric"
                                aria-labelledby="idle-host-pty-timeout-label"
                                value={settings.terminal.idleHostPtySuspendMinutes ?? DEFAULT_IDLE_HOST_PTY_SUSPEND_MINUTES}
                                onChange={(e) => {
                                    const minutes = Math.max(1, Math.min(60, Number(e.target.value) || 1));
                                    void updateTerminalSettings({ idleHostPtySuspendMinutes: minutes });
                                }}
                                className="w-16 min-h-[36px] rounded-lg border border-[var(--color-app-border)] bg-[var(--color-app-bg)]/50 px-2 py-1.5 text-sm text-center text-[var(--color-app-text)] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none focus:outline-none focus:border-[var(--color-app-accent)] focus:ring-1 focus:ring-[var(--color-app-accent)]/20"
                            />
                        </div>
                    )}
                </div>
            </Section>

            <div className="h-px bg-[var(--color-app-border)]/20 my-2" />

            <Section title="Ghost suggestions">
                <div className="space-y-1">
                    <Toggle
                        label="Inline ghost text"
                        description="Show faded fish-style inline completion while typing."
                        checked={settings.ghostSuggestions?.inlineEnabled ?? true}
                        onChange={(value) => { setGhostSuggestionsField({ inlineEnabled: value }); }}
                    />
                    <Toggle
                        label="Context-menu suggestion actions"
                        description="Show suggestion actions in terminal right-click context menu."
                        checked={settings.ghostSuggestions?.contextMenuEnabled ?? false}
                        onChange={(value) => { setGhostSuggestionsField({ contextMenuEnabled: value }); }}
                    />
                    <div className="px-3 py-2 space-y-1">
                        <Select
                            label="Native shell sessions"
                            value={settings.ghostSuggestions?.nativeShellPolicy ?? 'auto'}
                            onChange={(value) => {
                                if (value === 'auto' || value === 'always' || value === 'off') {
                                    setGhostSuggestionsField({ nativeShellPolicy: value });
                                }
                            }}
                            options={[
                                { value: 'auto', label: 'Auto (recommended)' },
                                { value: 'always', label: 'Always on' },
                                { value: 'off', label: 'Off for native shells' },
                            ]}
                            className="bg-app-bg/50"
                        />
                        <p className="text-[10px] text-[var(--color-app-muted)] pl-1">
                            Auto hides inline ghost on fish and on zsh only when zsh-autosuggestions is detected in init files.
                        </p>
                    </div>

                    <div className="rounded-lg border border-[var(--color-app-border)]/50 bg-[var(--color-app-bg)]/25 px-1 pt-3 pb-1 mt-2">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--color-app-muted)] px-3 pb-1">
                            Providers
                        </div>
                        <Toggle
                            label="History"
                            description="Suggest commands based on your past usage for this server/session scope."
                            checked={settings.ghostSuggestions?.providers?.history ?? true}
                            onChange={(value) => { setGhostProviderField({ history: value }); }}
                        />
                        <Toggle
                            label="Filesystem paths"
                            description="Suggest local/remote path candidates for commands like cd."
                            checked={settings.ghostSuggestions?.providers?.filesystem ?? true}
                            onChange={(value) => { setGhostProviderField({ filesystem: value }); }}
                        />
                    </div>
                </div>
            </Section>
        </div>
    );
}