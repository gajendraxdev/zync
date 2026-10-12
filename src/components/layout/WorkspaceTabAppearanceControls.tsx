import { useId, useRef, useState } from 'react';
import {
    changeMainTabPresentation, MAIN_TAB_ICONS, MAIN_TAB_CLOSE_BUTTON_OPTIONS, parseMainTabPresentation,
    type MainTabPresentationAction,
} from '../../features/workspace/domain/mainTabPresentation';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { Toolbar } from '../ui/Toolbar';
import { WorkspaceTabIcon } from './WorkspaceTabDecoration';

const ICON_OPTIONS = [
    { value: 'default', label: 'Resource icon (default)' },
    ...MAIN_TAB_ICONS.map(({ id, label }) => ({ value: id, label, icon: <WorkspaceTabIcon icon={id} fallback={null} size={14} /> })),
];
const CLOSE_OPTIONS = [
    { value: 'default', label: 'Use app setting' },
    ...MAIN_TAB_CLOSE_BUTTON_OPTIONS.filter(option => option.value !== 'hover'),
];

/** Tab-owned display controls. Metadata applies locally; the session owner reports disk failures.
 * Mount per tab/opening so an unfinished accent draft cannot leak to another tab.
 */
export function WorkspaceTabAppearanceControls({ value, onChange }: {
    value: unknown;
    onChange: (action: MainTabPresentationAction) => boolean;
}) {
    const parsed = parseMainTabPresentation(value);
    const current = parsed.ok ? parsed.value : undefined;
    const [draft, setDraft] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const composing = useRef(false);
    const colorInput = useRef<HTMLInputElement>(null);
    const hintId = useId();
    const color = draft ?? current?.accent ?? '';
    const accentChange: MainTabPresentationAction = { type: 'set-accent', accent: color === '' ? undefined : color };
    const candidate = changeMainTabPresentation(value, accentChange);
    const apply = (action: MainTabPresentationAction) => {
        if (!parsed.ok) return false;
        try {
            if (onChange(action)) { setError(null); return true; }
        } catch { /* Keep drafts and report a stable message, not internal persistence details. */ }
        setError('This tab could not be updated. Please try again.');
        return false;
    };
    const applyAccent = () => {
        if (composing.current || !candidate.ok || !candidate.changed) return;
        if (apply(accentChange)) setDraft(null);
        colorInput.current?.focus();
    };

    return <section aria-label="Tab appearance" className="space-y-3">
        <p id={hintId} className="text-xs text-app-muted">
            Icon changes apply immediately. Apply accent saves the colour below.
        </p>
        {!parsed.ok && <p role="alert" className="text-xs text-app-danger">These tab preferences use an unsupported format. They have not been changed.</p>}
        <Select portal label="Tab icon" value={current?.icon ?? 'default'} options={ICON_OPTIONS} disabled={!parsed.ok}
            ariaDescribedBy={hintId} onChange={selected => {
                const icon = MAIN_TAB_ICONS.find(item => item.id === selected);
                if (selected === 'default' || icon) apply({ type: 'set-icon', icon: icon?.id });
            }} />
        <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-32"><Input ref={colorInput} label="Tab accent" value={color} placeholder="#123456"
                disabled={!parsed.ok} aria-describedby={`${hintId} ${hintId}-accent`}
                error={color !== '' && !candidate.ok && parsed.ok ? 'Use a six-digit hex color, such as #123456.' : undefined}
                onChange={event => { setDraft(event.target.value); setError(null); }}
                onCompositionStart={() => { composing.current = true; }}
                onCompositionEnd={() => { composing.current = false; }}
                onKeyDown={event => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault(); event.stopPropagation();
                    if (!event.nativeEvent.isComposing) applyAccent();
                }} /></div>
            <div className="w-12 shrink-0"><Input type="color" aria-label="Pick tab accent" className="px-1 py-1" disabled={!parsed.ok}
                value={candidate.ok ? candidate.value?.accent ?? '#808080' : current?.accent ?? '#808080'}
                onChange={event => { setDraft(event.target.value); setError(null); }} /></div>
            <Button type="button" variant="secondary" disabled={!candidate.ok || !candidate.changed}
                onClick={applyAccent}>Apply accent</Button>
        </div>
        <p id={`${hintId}-accent`} className="text-xs text-app-muted">Decorative line only. Leave empty and apply to remove.</p>
        <Select portal label="Close button override" value={current?.closeButton ?? 'default'} options={CLOSE_OPTIONS} disabled={!parsed.ok}
            ariaDescribedBy={`${hintId}-close`} onChange={mode => {
                if (mode === 'default' || mode === 'always' || mode === 'active' || mode === 'hidden') {
                    apply({ type: 'set-close-button', closeButton: mode === 'default' ? undefined : mode });
                }
            }} />
        <p id={`${hintId}-close`} className="text-xs text-app-muted">App default is in Settings → Layout & Navigation. Right-click → Close tab remains available.</p>
        <Toolbar label="Tab appearance actions">
            <Button type="button" variant="secondary" size="sm" disabled={!parsed.ok}
                onClick={() => { if (apply({ type: 'reset-appearance' })) setDraft(null); }}>Reset appearance</Button>
        </Toolbar>
        {error && <p role="alert" className="text-xs text-app-danger">{error}</p>}
    </section>;
}
