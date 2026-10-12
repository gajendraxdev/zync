import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../lib/utils';
import { shortcutHint } from '../../../features/shortcuts/labels';
import { navigationOrder, type NavigationChange, type NavigationId, type WorkspaceNavigation } from '../../../features/workspace/domain/navigation';
import type { GlobalNavigationAction } from '../../../features/workspace/application/globalNavigation';
import { Button } from '../../ui/Button';
import { Tooltip } from '../../ui/Tooltip';
import { CONTROL_INSET_FOCUS_CLASSES } from '../../ui/controlStyles';
import { ContextMenu } from '../../ui/ContextMenu';
import { navigationContextMenu } from './navigationContextMenu';
import { GLOBAL_NAVIGATION_ENTRIES, type NavigationEntry } from './navigationItems';
import { useTabDragPointer } from '../tabDrag/useTabDragPointer';
import { createTabDragPreview } from '../tabDrag/preview';
import { createTabReorderFeedback, scrollTabStrip, tabReorderTarget } from '../tabDrag/reorder';

/** Global navigation chrome only. Shared pointer gestures reorder buttons, never host resources. */
export function ActivityBar({ preferences, hasWorkspace, keybindings, onCommand, onCustomize, entries = GLOBAL_NAVIGATION_ENTRIES, onPlugin, onGlobal, onChange, onError, footer, activeId, workspaceBadge, workspaceLabel }: {
    preferences: WorkspaceNavigation;
    hasWorkspace: boolean;
    keybindings: Readonly<Record<string, string | undefined>>;
    onCommand: (id: string) => void;
    onCustomize: () => void;
    entries?: readonly NavigationEntry[];
    onPlugin?: (viewId: string) => void;
    onGlobal?: (id: GlobalNavigationAction) => void;
    onChange?: (action: NavigationChange) => Promise<void>;
    onError?: (error: unknown) => void;
    footer?: ReactNode;
    activeId?: NavigationId;
    workspaceBadge?: ReactNode;
    workspaceLabel?: string;
}) {
    const root = useRef<HTMLElement>(null);
    const focused = useRef<HTMLButtonElement | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; id?: NavigationId; keyboard: boolean } | null>(null);
    const [saving, setSaving] = useState(false);
    const pending = useRef(0);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const change = async (action: NavigationChange) => {
        if (!onChange) return;
        pending.current++;
        setSaving(true);
        try { await onChange(action); }
        catch (error) { onError?.(error); }
        finally { pending.current--; if (alive.current) setSaving(pending.current > 0); }
    };
    const order = navigationOrder(preferences, entries.map(entry => entry.id))
        .filter(id => !preferences.hidden.includes(id) && entries.some(entry => entry.id === id)
            && (id !== 'workspace' || preferences.workspaceTabsPosition !== 'default'));
    const signature = JSON.stringify([preferences.visible, preferences.position, order]);
    const latest = useRef({ signature, onChange: change });
    latest.current = { signature, onChange: change };
    const drag = useTabDragPointer<NavigationId>((target, id, origin) => {
        if (!onChange) return null;
        const source = target.closest<HTMLElement>('[data-navigation-item]');
        if (!source || source.dataset.navigationItem !== id) return null;
        let preview: ReturnType<typeof createTabDragPreview> = null;
        let feedback: ReturnType<typeof createTabReorderFeedback> = null;
        const valid = () => source.isConnected && latest.current.signature === signature;
        return {
            isValid: valid,
            start: () => { preview = createTabDragPreview(source, origin); feedback = createTabReorderFeedback(source); },
            move: point => { feedback?.update(tabReorderTarget(source, point, 'reorder')); preview?.move(point); return scrollTabStrip(source, point); },
            resolveDrop: point => {
                const destination = tabReorderTarget(source, point, 'reorder')?.element.dataset.navigationItem;
                if (!destination || !order.includes(destination as NavigationId)) return null;
                return () => {
                    if (!valid()) return false;
                    void latest.current.onChange({ type: 'move', id, targetId: destination as NavigationId });
                    return true;
                };
            },
            cancel: () => {},
            dispose: () => { preview?.dispose(); feedback?.dispose(); },
        };
    });
    useEffect(() => {
        if (focused.current && !focused.current.isConnected) {
            focused.current = null;
            if (document.activeElement === document.body) root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
        }
    }, [entries, preferences]);
    if (!preferences.visible) return null;
    const closeMenu = () => {
        setMenu(null);
        // Do not steal focus from a dialog or another surviving control.
        if (document.activeElement === document.body || document.activeElement?.closest('.context-menu-container')) {
            (focused.current?.isConnected ? focused.current : root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
        }
    };
    const items = navigationContextMenu({ preferences, entries, keybindings, selectedId: menu?.id,
        editable: Boolean(onChange) && !saving, onChange: action => { void change(action); }, onCustomize });
    return <nav ref={root} data-zync-color="navigation" aria-label="Global navigation" aria-busy={saving}
        onFocusCapture={event => {
            // Portaled context-menu focus bubbles through React, but is not the opener.
            if (event.target instanceof HTMLButtonElement && root.current?.contains(event.target)) focused.current = event.target;
        }}
        onContextMenu={event => {
            event.preventDefault(); event.stopPropagation();
            const node = (event.target as Element).closest<HTMLElement>('[data-navigation-item]');
            focused.current = node?.querySelector<HTMLButtonElement>('button') ?? focused.current;
            const id = node?.dataset.navigationItem;
            setMenu({ x: event.clientX, y: event.clientY, id: id as NavigationId | undefined, keyboard: false });
        }}
        onKeyDown={event => {
            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
            event.preventDefault(); event.stopPropagation();
            const node = (event.target as Element).closest<HTMLElement>('[data-navigation-item]');
            const bounds = (node ?? event.currentTarget).getBoundingClientRect();
            setMenu({ x: bounds.right, y: bounds.top, id: node?.dataset.navigationItem as NavigationId | undefined, keyboard: true });
        }}
        className={cn('flex h-full min-h-0 min-w-0 flex-col gap-1 bg-app-panel p-1 border-app-border',
            preferences.position === 'right' ? 'border-l' : 'border-r')}>
        <div data-tab-drag-strip data-tab-drag-axis="vertical" className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden">
            {order.map(id => {
                const entry = entries.find(item => item.id === id)!;
                const { action, icon: Icon, requiresWorkspace, label, detail } = entry;
                const contextualLabel = id === 'workspace' && workspaceLabel ? `${label} — ${workspaceLabel}` : label;
                const hint = shortcutHint(entry.shortcutId ?? (action.kind === 'command' ? action.commandId : ''), keybindings);
                return <div key={id} data-navigation-item={id} data-tab-drag-source data-tab-drag-item data-tab-drag-pinned="false"
                    className="shrink-0"
                    onPointerDown={event => drag.begin(event, id)}
                    onClickCapture={event => { if (drag.consumeClickIfDragged()) { event.preventDefault(); event.stopPropagation(); } }}>
                    <div data-tab-drag-visual>
                        <Tooltip content={hint ? `${contextualLabel} (${hint})` : contextualLabel} position={preferences.position === 'right' ? 'left' : 'right'} disabled={menu !== null}>
                            <Button data-workspace-tab-trigger data-zync-color="navigationItem" type="button" variant="ghost" size="icon"
                                aria-label={detail ? `${contextualLabel} (${detail})` : contextualLabel} aria-current={activeId === id ? 'page' : undefined}
                                disabled={(requiresWorkspace && !hasWorkspace) || (action.kind === 'plugin' && !onPlugin)}
                                onClick={() => action.kind === 'command' ? onCommand(action.commandId)
                                    : action.kind === 'global' ? onGlobal?.(action.id) : onPlugin?.(action.viewId)}
                                className={cn('shrink-0', CONTROL_INSET_FOCUS_CLASSES, activeId === id && 'bg-app-surface text-app-text')}>
                                <span aria-hidden="true" className="relative flex h-5 w-5 items-center justify-center">
                                    <Icon size={18} />
                                    {id === 'workspace' && workspaceBadge && <span data-workspace-host-badge
                                        className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-sm bg-app-panel">{workspaceBadge}</span>}
                                </span>
                            </Button>
                        </Tooltip>
                    </div>
                    <div hidden aria-hidden="true"><div data-tab-drag-preview className="flex h-8 items-center gap-2 rounded-md bg-app-panel p-2 text-xs text-app-text">
                        <Icon size={18} aria-hidden="true" /><span>{label}</span>
                    </div></div>
                </div>;
            })}
        </div>
        {footer ?? <Button type="button" variant="ghost" size="sm" onClick={onCustomize}>Customize navigation</Button>}
        {menu && <ContextMenu x={menu.x} y={menu.y} items={items} autoFocus={menu.keyboard}
            ariaLabel="Navigation options" className="w-72" onClose={closeMenu} />}
    </nav>;
}
