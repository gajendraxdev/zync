import { useId } from 'react';
import { Check, Keyboard } from 'lucide-react';
import type { TerminalFocusShortcutPolicy } from '../../../features/shortcuts/policy';
import { MenuSubmenu } from '../../ui/MenuSubmenu';

/** Shortcut choices share the same flyout renderer as context-menu submenus. */
export function TerminalShortcutMenu({ value, pending, onChange, onManage }: {
    value: TerminalFocusShortcutPolicy;
    pending: boolean;
    onChange: (value: TerminalFocusShortcutPolicy) => void;
    onManage?: () => void;
}) {
    const descriptionId = useId();
    return <MenuSubmenu label="Keyboard shortcuts" icon={<Keyboard size={13} />} descriptionId={descriptionId}
        localKeyboard triggerClassName="font-medium">
        <p id={descriptionId} className="px-3 py-1 text-[10px] text-app-muted">Applies to all terminals</p>
        {([
            { value: 'shell', label: 'Terminal first' },
            { value: 'app', label: 'Zync first' },
        ] as const).map(option => (
            <button key={option.value} type="button" role="menuitemradio" aria-checked={value === option.value} aria-disabled={pending}
                onClick={() => { if (!pending && value !== option.value) onChange(option.value); }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-app-text hover:bg-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent aria-disabled:opacity-60"
            >
                <Check size={13} className={value === option.value ? 'text-app-accent' : 'invisible'} aria-hidden="true" />
                <span>{option.label}</span>
            </button>
        ))}
        {pending && <p role="status" className="px-3 text-xs text-app-muted">Saving…</p>}
        {onManage && <>
            <div role="separator" className="my-1 border-t border-app-border" />
            <button type="button" role="menuitem" onClick={onManage}
                className="w-full px-3 py-2 rounded-lg text-left text-xs text-app-text hover:bg-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent">
                View &amp; edit shortcuts…
            </button>
        </>}
    </MenuSubmenu>;
}
