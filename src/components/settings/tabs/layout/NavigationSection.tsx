import { useRef, useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { parseWorkspaceNavigation, resolveWorkspaceNavigation, isNavigationId, navigationOrder, type NavigationChange, type NavigationPosition, type WorkspaceTabsPosition } from '../../../../features/workspace/domain/navigation';
import { GLOBAL_NAVIGATION_ENTRIES, type NavigationEntry } from '../../../layout/navigation/navigationItems';
import { Section } from '../../common/Section';
import { Toggle } from '../../common/Toggle';
import { Button } from '../../../ui/Button';
import { IconButton } from '../../../ui/IconButton';
import { Select } from '../../../ui/Select';

const DRAG_TYPE = 'application/x-zync-navigation-item';
const POSITIONS = ['left', 'right'] as const;

/** Settings and drag/keyboard controls edit one preference reducer; they never move live view hosts. */
export function NavigationSection({ value, onChange, entries = GLOBAL_NAVIGATION_ENTRIES }: {
    value: unknown; onChange: (action: NavigationChange) => Promise<void>;
    entries?: readonly NavigationEntry[];
}) {
    const parsed = parseWorkspaceNavigation(value);
    const preferences = resolveWorkspaceNavigation(value);
    const order = navigationOrder(preferences, entries.map(entry => entry.id)).filter(id => entries.some(entry => entry.id === id)
        && (id !== 'workspace' || preferences.workspaceTabsPosition !== 'default'));
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const pending = useRef(0);
    const latestRequest = useRef(0);
    const alive = useRef(true);
    const root = useRef<HTMLDivElement>(null);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const apply = async (action: NavigationChange) => {
        if (!parsed) return;
        const request = ++latestRequest.current;
        pending.current++;
        setSaving(true);
        setError(null);
        const focused = document.activeElement;
        const row = focused instanceof HTMLElement ? focused.closest('[data-navigation-row]') : null;
        try { await onChange(action); }
        catch { if (alive.current) setError('A navigation change could not be saved. Review your choices and try again.'); }
        finally {
            pending.current--;
            if (alive.current) {
                setSaving(pending.current > 0);
                // Reordering may disable an endpoint button. Preserve the same item's keyboard location.
                requestAnimationFrame(() => {
                    if (!alive.current || request !== latestRequest.current || !root.current?.contains(row) || !(focused instanceof HTMLButtonElement)
                        || !focused.disabled || (document.activeElement !== focused && document.activeElement !== document.body)) return;
                    row?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus();
                });
            }
        }
    };
    return <Section title="Navigation">
        <div ref={root} aria-busy={saving} className="space-y-3">
            {!parsed && <p role="alert" className="text-sm text-control-danger">Navigation settings use an unsupported format. They are preserved; review settings.json before editing them.</p>}
            <Toggle label="Activity bar" description="Global Hosts, Public URLs, Port Forwarding, Snippets, Vaults and Plugins navigation. Shown by default; your saved visibility choice is preserved."
                checked={preferences.visible} disabled={!parsed} onChange={visible => { void apply({ type: 'visible', value: visible }); }} />
            <Select portal label="Navigation position" value={preferences.position} disabled={!parsed}
                options={POSITIONS.map(position => ({ value: position, label: position[0].toUpperCase() + position.slice(1) }))}
                onChange={position => { if (position === 'left' || position === 'right') void apply({ type: 'position', value: position as NavigationPosition }); }} />
            <p className="text-xs text-app-muted">Navigation uses icons. Hover or focus an icon for its name and shortcut; edit bindings in Settings → Shortcuts.</p>
            <p className="text-xs text-app-muted">Drag navigation buttons directly, drag these handles, or use Move earlier/later. Settings and Profile stay at the bottom; when the activity bar is hidden, they move to the title bar.</p>
            <ul aria-label="Navigation items" className="space-y-1">
                {order.map((id, index) => {
                    const entry = entries.find(item => item.id === id)!;
                    const label = entry.detail ? `${entry.label} (${entry.detail})` : entry.label;
                    return <li key={id} data-navigation-row={id} className="flex flex-wrap items-center gap-1 rounded-md border border-app-border p-1"
                        onDragOver={event => { if (parsed && event.dataTransfer.types.includes(DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
                        onDrop={event => {
                            const source = event.dataTransfer.getData(DRAG_TYPE);
                            if (!parsed || !isNavigationId(source) || !order.includes(source)) return;
                            event.preventDefault();
                            void apply({ type: 'move', id: source, targetId: id });
                        }}>
                        <IconButton label={`Drag ${label}`} disabled={!parsed} draggable={Boolean(parsed)}
                            onDragStart={event => { event.dataTransfer.setData(DRAG_TYPE, id); event.dataTransfer.effectAllowed = 'move'; }}
                            icon={<GripVertical size={16} aria-hidden="true" />} />
                        <div className="min-w-0 flex-1"><Toggle label={label} description=""
                            checked={!preferences.hidden.includes(id)} disabled={!parsed}
                            onChange={visible => { void apply({ type: 'hidden', id, value: !visible }); }} /></div>
                        <IconButton label={`Move ${label} earlier`} disabled={!parsed || index === 0}
                            onClick={() => { void apply({ type: 'move', id, targetId: order[index - 1] }); }}
                            icon={<ArrowUp size={16} aria-hidden="true" />} />
                        <IconButton label={`Move ${label} later`} disabled={!parsed || index === order.length - 1}
                            onClick={() => { void apply({ type: 'move', id, targetId: order[index + 1] }); }}
                            icon={<ArrowDown size={16} aria-hidden="true" />} />
                    </li>;
                })}
            </ul>
            <Button type="button" size="sm" variant="secondary" disabled={!parsed} onClick={() => { void apply({ type: 'reset' }); }}>Reset navigation</Button>
            <Select portal label="Host workspace tabs" value={preferences.workspaceTabsPosition ?? 'default'} disabled={!parsed}
                options={[{ value: 'default', label: 'Current position' }, { value: 'left', label: 'Left sidebar' }, { value: 'right', label: 'Right sidebar' }]}
                onChange={position => { if (['default', 'left', 'right'].includes(position)) void apply({ type: 'workspace-tabs', value: position as WorkspaceTabsPosition }); }} />
            <p className="text-xs text-app-muted">Moves the host’s pane tabs into the shared resizable sidebar. Hosts and Plugins use the same panel. You can also right-click the pane strip or drag its grip to an edge. Current position restores the horizontal strip. No sessions are opened or restarted.</p>
            <p role="status" className="text-xs text-app-muted">{saving ? 'Saving navigation…' : ''}</p>
            {error && <p role="alert" className="text-sm text-control-danger">{error}</p>}
        </div>
    </Section>;
}
