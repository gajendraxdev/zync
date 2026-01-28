interface KeyboardKeyProps {
    children: string;
    className?: string;
}

export function KeyboardKey({ children, className = '' }: KeyboardKeyProps) {
    return (
        <kbd className={`inline-flex items-center justify-center px-2 py-1 min-w-[24px] text-[10px] font-bold text-[var(--color-app-text)] bg-[var(--color-app-surface)] border border-[var(--color-app-border)] rounded shadow-sm ${className}`}>
            {children}
        </kbd>
    );
}
