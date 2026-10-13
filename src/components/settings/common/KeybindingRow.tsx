import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { recordedShortcut } from '../../../features/shortcuts/bindings';
import { formatShortcutLabel } from '../../../lib/shortcuts';
import { Button } from '../../ui/Button';
import { Tooltip } from '../../ui/Tooltip';

interface KeybindingRowProps {
    label: string;
    binding: string;
    onChange: (value: string) => void;
    defaultBinding?: string;
    aliases?: readonly string[];
    disabled?: boolean;
    readOnly?: boolean;
    warning?: string;
    validate?: (value: string) => string | undefined;
    children?: ReactNode;
}

/** Record a chord, never shell text. Persistence/conflicts are owned by the parent. */
export function KeybindingRow({ label, binding, onChange, defaultBinding, aliases = [], disabled = false,
    readOnly = false, warning, validate, children }: KeybindingRowProps) {
    const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
    const [isRecording, setIsRecording] = useState(false);
    const [error, setError] = useState<string>();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const changeRef = useRef({ onChange, validate });
    const messageId = useId();
    const displayText = isRecording ? 'Recording…' : formatShortcutLabel(binding) || 'Not set';
    useEffect(() => { changeRef.current = { onChange, validate }; }, [onChange, validate]);

    const apply = (value: string) => {
        const issue = changeRef.current.validate?.(value);
        setError(issue);
        if (!issue) changeRef.current.onChange(value);
    };
    useEffect(() => {
        if (!isRecording || disabled) return;
        const stop = () => setIsRecording(false);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.isComposing || event.keyCode === 229 || event.getModifierState?.('AltGraph')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.key === 'Escape') { stop(); return; }
            const chord = recordedShortcut(event, isMac);
            if (!chord || event.repeat) return;
            const issue = changeRef.current.validate?.(chord);
            setError(issue);
            stop();
            if (!issue) changeRef.current.onChange(chord);
            buttonRef.current?.focus();
        };
        const visibility = () => { if (document.visibilityState !== 'visible') stop(); };
        const timeout = window.setTimeout(stop, 8000);
        window.addEventListener('keydown', handleKeyDown, { capture: true });
        window.addEventListener('blur', stop);
        document.addEventListener('visibilitychange', visibility);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, { capture: true });
            window.removeEventListener('blur', stop);
            document.removeEventListener('visibilitychange', visibility);
            window.clearTimeout(timeout);
        };
    }, [isRecording, disabled, isMac]);

    return <div data-shortcut-label={label} className="space-y-2 rounded-lg border border-app-border bg-app-bg/30 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 text-sm font-medium text-app-text">{label}</span>
            <div className="flex flex-wrap items-center gap-1">
                <Tooltip content={readOnly ? 'Built-in shortcut' : 'Press a shortcut. Escape cancels.'}>
                    {/* Keep focus during a save; guard activation without disabling the focused DOM node.
                        No deferred focus restoration can steal focus after the user moves elsewhere. */}
                    <Button ref={buttonRef} type="button" variant="secondary" size="sm" disabled={readOnly}
                        aria-disabled={disabled || readOnly}
                        data-zync-shortcuts={isRecording ? 'local' : undefined}
                        data-zync-shortcut-recording={isRecording ? 'true' : undefined}
                        aria-label={label + ': ' + displayText} aria-describedby={messageId}
                        onClick={() => { if (!disabled && !readOnly) { setError(undefined); setIsRecording(true); } }}
                        onBlur={() => setIsRecording(false)}
                        className="max-w-full whitespace-normal font-mono aria-disabled:opacity-50 aria-disabled:cursor-not-allowed">
                        {displayText}
                    </Button>
                </Tooltip>
                {!readOnly && <>
                    <Tooltip content={aliases.length ? 'Remove this binding and its fixed aliases. Independent secondary bindings are unchanged.' : 'Remove only this binding. Other bindings for this action are unchanged.'}>
                        <Button type="button" variant="ghost" size="sm" disabled={disabled || isRecording || !binding}
                            aria-label={'Remove shortcut for ' + label} onClick={() => apply('')}>Remove</Button>
                    </Tooltip>
                    {defaultBinding !== undefined && <Tooltip content="Restore the default shortcut">
                        <Button type="button" variant="ghost" size="sm" disabled={disabled || isRecording || binding === defaultBinding}
                            aria-label={'Reset shortcut for ' + label} onClick={() => apply(defaultBinding)}>Reset</Button>
                    </Tooltip>}
                </>}
            </div>
        </div>
        {binding && aliases.length > 0 && <p className="text-xs text-app-muted">
            Also works with: {aliases.map(chord => formatShortcutLabel(chord)).join(' / ')} (built-in alternates).
        </p>}
        {children}
        <p id={messageId} role="status" aria-live="polite" className="text-xs text-app-muted">
            {error || warning || (isRecording ? 'Press a shortcut; Escape cancels. Recording ends after 8 seconds.' : readOnly ? 'Built-in binding; terminal availability can be customized below.' : '')}
        </p>
    </div>;
}
