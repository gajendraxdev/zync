export interface TerminalTabIntroProps {
    onOpenAppearance: () => void;
}

export function TerminalTabIntro({
    onOpenAppearance,
}: TerminalTabIntroProps) {
    return (
        <div className="rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/30 px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
                Fonts, cursor, transparency and terminal behavior are configured below.{' '}
                <button
                    type="button"
                    onClick={onOpenAppearance}
                    className="font-semibold text-[var(--color-app-accent)] hover:underline"
                >
                    Open Appearance
                </button>
                {' '}for the shared theme, accent and terminal default colors.
            </p>
            <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
                Connection color presets take precedence over terminal default colors.
            </p>
        </div>
    );
}
