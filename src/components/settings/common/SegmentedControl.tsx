import { clsx } from 'clsx';
import type { KeyboardEvent } from 'react';

export interface SegmentedOption<T extends string> {
    key: T;
    label: string;
}

export interface SegmentedControlProps<T extends string> {
    options: ReadonlyArray<SegmentedOption<T>>;
    value: T;
    onChange: (value: T) => void;
    ariaLabel: string;
    idPrefix: string;
}

export function SegmentedControl<T extends string>({
    options,
    value,
    onChange,
    ariaLabel,
    idPrefix,
}: SegmentedControlProps<T>) {
    const moveTab = (nextIndex: number) => {
        const nextOption = options[nextIndex];
        if (!nextOption) {
            return;
        }
        onChange(nextOption.key);
        requestAnimationFrame(() => {
            document.getElementById(`${idPrefix}-tab-${nextOption.key}`)?.focus();
        });
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            moveTab((currentIndex + 1) % options.length);
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            moveTab((currentIndex - 1 + options.length) % options.length);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            moveTab(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            moveTab(options.length - 1);
        }
    };

    return (
        <div
            className="flex bg-[var(--color-app-surface)]/50 p-1 rounded-lg border border-[var(--color-app-border)]/50"
            role="tablist"
            aria-label={ariaLabel}
        >
            {options.map((option, index) => (
                <button
                    key={option.key}
                    id={`${idPrefix}-tab-${option.key}`}
                    role="tab"
                    type="button"
                    aria-selected={value === option.key}
                    aria-controls={`${idPrefix}-panel-${option.key}`}
                    tabIndex={value === option.key ? 0 : -1}
                    onClick={() => onChange(option.key)}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                    className={clsx(
                        'flex-1 py-1.5 text-xs font-medium rounded-md transition-all',
                        value === option.key
                            ? 'bg-[var(--color-app-accent)] text-white shadow-sm'
                            : 'text-[var(--color-app-muted)] hover:text-[var(--color-app-text)] hover:bg-[var(--color-app-surface)]',
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}