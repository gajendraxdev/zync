import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CHROME_ACTIONS, parseChromeActions, type ChromeActionArea, type ChromeActionChange } from '../../../../features/workspace/domain/chromeActions';
import { Section } from '../../common/Section';
import { Button } from '../../../ui/Button';
import { Switch } from '../../../ui/Switch';

const LABELS = { workspaceToolbar: 'Workspace toolbar', statusBar: 'Status bar actions' };
const DESCRIPTIONS: Partial<Record<(typeof CHROME_ACTIONS)[number]['id'], string>> = {
    'workspace.splits': 'The split buttons show or hide together as one group.',
    'workspace.sessionTools': 'Opens session snippets and terminal controls.',
};

/** Reusable presentation editor: saving is acknowledged; native feature handlers remain untouched. */
export function ChromeActionsSection({ value, area, loading = false, onChange }: {
    value: unknown; area: ChromeActionArea; loading?: boolean;
    onChange: (action: ChromeActionChange) => Promise<void>;
}) {
    const parsed = parseChromeActions(value);
    const group = (parsed ?? parseChromeActions(undefined)!)[area];
    // The editor lists choices, not an inventory of protected status indicators.
    const optionalActions = group.order.map(id => CHROME_ACTIONS.find(entry => entry.id === id)!)
        .filter(action => action.optional);
    const [saving, setSaving] = useState(false);
    const [revision, setRevision] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const busy = useRef(false); const alive = useRef(true);
    const root = useRef<HTMLDivElement>(null);
    const returnFocus = useRef<HTMLButtonElement | null>(null);
    const disabled = loading || saving || !parsed;
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useLayoutEffect(() => {
        if (saving) return;
        const focused = returnFocus.current; returnFocus.current = null;
        if (!focused || loading || !root.current?.contains(focused)
            || (document.activeElement !== focused && document.activeElement !== document.body)) return;
        const fallback = focused.closest('[data-chrome-action-row]')?.querySelector<HTMLButtonElement>('button:not([disabled])');
        (focused.disabled ? fallback : focused)?.focus();
    }, [saving, loading, revision]);
    const apply = async (action: ChromeActionChange) => {
        if (disabled || busy.current) return;
        busy.current = true; setSaving(true); setError(null);
        const focused = document.activeElement;
        returnFocus.current = focused instanceof HTMLButtonElement && root.current?.contains(focused) ? focused : null;
        try { await onChange(action); }
        catch { if (alive.current) setError('This change could not be saved. Review your choices and try again.'); }
        finally {
            busy.current = false;
            if (alive.current) { setSaving(false); setRevision(value => value + 1); }
        }
    };
    return <Section title={LABELS[area]}>
        <div ref={root} data-chrome-customization={area} role="group" aria-label={LABELS[area]} tabIndex={-1}
            className="space-y-3 focus:outline-none" aria-busy={saving}>
            <p className="text-xs text-app-muted">Turn optional controls on or off without closing their content. Reset restores this area only.</p>
            {!parsed && <p role="alert" className="text-sm text-control-danger">These preferences use an unsupported format. They are preserved; review settings.json before editing them.</p>}
            <ul aria-label={LABELS[area]} className="space-y-1">
                {optionalActions.map(action => <li key={action.id} data-chrome-action-row={action.id}
                    className="flex flex-wrap items-center gap-1 rounded-md border border-app-border p-1">
                    <Switch label={action.label} description={DESCRIPTIONS[action.id]} showLabel
                        checked={!group.hidden.includes(action.id)} disabled={disabled}
                        onCheckedChange={visible => { void apply({ type: 'hidden', id: action.id, value: !visible }); }} />
                </li>)}
            </ul>
            <p className="text-xs text-app-muted">{area === 'workspaceToolbar'
                ? 'The Add button stays available. Pane actions are available by right-clicking a tab or pane header.'
                : 'Essential status indicators and sidebar recovery remain available when needed.'}</p>
            <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => { void apply({ type: 'reset', area }); }}>Reset {area === 'workspaceToolbar' ? 'toolbar' : 'status actions'}</Button>
            <p role="status" className="text-xs text-app-muted">{saving ? 'Saving preferences…' : ''}</p>
            {error && <p role="alert" className="text-sm text-control-danger">{error}</p>}
        </div>
    </Section>;
}
