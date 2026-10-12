import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { ChromeActionArea } from '../../features/workspace/domain/chromeActions';
import { useAppStore } from '../../store/useAppStore';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { chromeVisibilityMenu } from './chromeVisibilityMenu';

/** Visibility and settings shortcuts reuse the acknowledged preference owner. */
export function useChromeCustomizationMenu(area: ChromeActionArea) {
    const openSettings = useAppStore(state => state.openSettings);
    const value = useAppStore(state => state.settings.chromeActions);
    const loading = useAppStore(state => state.isLoadingSettings || state.isReloadingSettings);
    const updateChromeActions = useAppStore(state => state.updateChromeActions);
    const showToast = useAppStore(state => state.showToast);
    const [anchor, setAnchor] = useState<{ x: number; y: number; keyboard: boolean } | null>(null);
    const [saving, setSaving] = useState(false);
    const opener = useRef<HTMLElement | null>(null);
    const busy = useRef(false);
    const alive = useRef(true);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const visibilityItems = chromeVisibilityMenu(value, area, (id, hidden) => {
        if (busy.current || loading) return;
        busy.current = true; setSaving(true);
        void updateChromeActions({ type: 'hidden', id, value: hidden })
            .catch(() => showToast('error', 'Could not save action visibility. Please try again.'))
            .finally(() => { busy.current = false; if (alive.current) setSaving(false); });
    }, loading || saving);
    const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, keyboard: boolean) => {
        if (event.defaultPrevented) return;
        event.preventDefault(); event.stopPropagation();
        opener.current = event.target instanceof Element ? event.target.closest<HTMLElement>('button') ?? event.currentTarget : event.currentTarget;
        const rect = event.currentTarget.getBoundingClientRect();
        setAnchor({ x: keyboard ? rect.left : (event as MouseEvent).clientX,
            y: keyboard ? rect.bottom : (event as MouseEvent).clientY, keyboard });
    };
    const restoreFocus = () => {
        // Do not steal focus from an outside control that dismissed the menu.
        if (opener.current?.isConnected && (document.activeElement === document.body
            || document.activeElement?.closest('[role="menu"]'))) opener.current.focus({ preventScroll: true });
    };
    const label = area === 'workspaceToolbar' ? 'Customize toolbar…' : 'Customize status bar…';
    // An embedding menu owns its own opener; never restore a stale chrome opener.
    const item: ContextMenuItem = { label, action: () =>
        openSettings('layout', area) };
    const items: ContextMenuItem[] = [...visibilityItems, { separator: true }, item];
    return {
        item,
        items,
        onContextMenu: (event: MouseEvent<HTMLElement>) => open(event, false),
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) open(event, true);
        },
        menu: anchor && <ContextMenu x={anchor.x} y={anchor.y} autoFocus={anchor.keyboard}
            ariaLabel={area === 'workspaceToolbar' ? 'Toolbar options' : 'Status bar options'}
            onClose={() => { restoreFocus(); setAnchor(null); }} items={items.map(entry =>
                'separator' in entry || 'children' in entry ? entry : { ...entry, action: () => {
                    restoreFocus(); entry.action?.();
                } })} />,
    };
}
