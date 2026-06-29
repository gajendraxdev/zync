export interface TerminalTabIntroProps {
    onOpenAppearanceTerminal: () => void;
    onOpenAppearanceApp: () => void;
}

export function TerminalTabIntro({
    onOpenAppearanceTerminal,
    onOpenAppearanceApp,
}: TerminalTabIntroProps) {
    return (
        <div className="rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/30 px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
                <button
                    type="button"
                    onClick={onOpenAppearanceTerminal}
                    className="font-semibold text-[var(--color-app-accent)] hover:underline"
                >
                    Font, opacity, and cursor
                </button>
                {' '}are in Appearance → Terminal.
                {' '}
                <button
                    type="button"
                    onClick={onOpenAppearanceApp}
                    className="font-semibold text-[var(--color-app-accent)] hover:underline"
                >
                    Theme and accent colors
                </button>
                {' '}are in Appearance → App.
            </p>
            <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
                This tab covers rendering performance, shell behavior, and input assistance.
            </p>
        </div>
    );
}