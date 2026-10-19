import { useId, useState } from 'react';
import type { AppSettings } from '../../../store/settingsSlice';
import { normalizeTerminalRightClickAction } from '../../../lib/terminal/terminalMousePolicy';
import { Select } from '../../ui/Select';
import { Toggle } from './Toggle';

interface TerminalMouseControlsProps {
    settings: AppSettings['terminal'];
    onChange: (patch: Partial<AppSettings['terminal']>) => Promise<void>;
}

/** Shared global mouse preferences for Settings and the terminal sidebar; one save path. */
export function TerminalMouseControls({ settings, onChange }: TerminalMouseControlsProps) {
    const id = useId();
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    /** Save only the requested fields and expose failures without duplicate error toasts. */
    const save = async (patch: Partial<AppSettings['terminal']>) => {
        setPending(true);
        setError('');
        try { await onChange(patch); }
        catch { setError('Could not save mouse settings. Please try again.'); }
        finally { setPending(false); }
    };
    return <div>
        <div className="space-y-2 px-3 py-3">
            <label htmlFor={id} className="text-xs font-medium text-app-text">Right-click action</label>
            <Select id={id} ariaLabel="Right-click action" ariaDescribedBy={`${id}-help`}
                value={normalizeTerminalRightClickAction(settings.rightClickAction)} disabled={pending}
                onChange={value => { void save({ rightClickAction: normalizeTerminalRightClickAction(value) }); }}
                showSearch={false} portal
                options={[
                    { value: 'context-menu', label: 'Context menu' },
                    { value: 'auto', label: 'Pass to terminal / Paste' },
                ]} />
            <p id={`${id}-help`} className="text-xs text-app-muted">
                Shift + right-click opens Zync’s menu.
            </p>
        </div>
        <Toggle label="Copy on selection" checked={settings.copyOnSelect === true} disabled={pending}
            description="Copy selected text automatically."
            onChange={value => { void save({ copyOnSelect: value }); }} />
        {pending && <p role="status" className="px-3 pb-2 text-xs text-app-muted">Saving…</p>}
        {error && <p role="alert" className="px-3 pb-2 text-xs text-app-danger">{error}</p>}
    </div>;
}
