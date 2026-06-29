export interface AppearanceTerminalColorsNoticeProps {
    onOpenAppTheme: () => void;
}

export function AppearanceTerminalColorsNotice({ onOpenAppTheme }: AppearanceTerminalColorsNoticeProps) {
    return (
        <div className="rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/30 px-3 py-2.5 space-y-2">
            <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
                Terminal text and background colors use the same app-wide theme and accent as the rest of Zync.
                There is no separate terminal theme yet.
            </p>
            <button
                type="button"
                onClick={onOpenAppTheme}
                className="text-[11px] font-semibold text-[var(--color-app-accent)] hover:underline"
            >
                Change theme and accent in App
            </button>
        </div>
    );
}