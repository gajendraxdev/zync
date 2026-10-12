import { useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { CONTROL_INSET_FOCUS_CLASSES } from '../ui/controlStyles';

/** Compact shared row; menus are portaled so scrolling never clips their actions. */
export function PluginSidebarItem({ name, description, version, status, icon, actions, trailing, disabled = false }: {
    name: string; description?: string; version?: string; status?: string; icon: ReactNode;
    actions?: ContextMenuItem[]; trailing?: ReactNode; disabled?: boolean;
}) {
    const trigger = useRef<HTMLButtonElement>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; keyboard: boolean } | null>(null);
    const closeMenu = () => {
        setMenu(null);
        if (document.activeElement?.closest('[role="menu"]')) trigger.current?.focus({ preventScroll: true });
    };
    return <li className="flex gap-2.5 py-3 min-w-0" onContextMenu={event => {
        if (!actions || disabled) return;
        event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY, keyboard: false });
    }}>
        <span aria-hidden="true" className="shrink-0 mt-0.5 text-app-muted">{icon}</span>
        <div className="min-w-0 flex-1">
            <div className="flex items-start gap-1 min-w-0">
                <span className="text-xs font-medium break-words min-w-0 flex-1">{name}</span>
                {actions && <Tooltip content={`Actions for ${name}`}>
                    <IconButton ref={trigger} label={`Actions for ${name}`} icon={<MoreHorizontal size={14} />}
                        disabled={disabled} aria-haspopup="menu" aria-expanded={Boolean(menu)}
                        className={`h-6 w-6 -mt-1 ${CONTROL_INSET_FOCUS_CLASSES}`} onClick={event => {
                            if (menu) { closeMenu(); return; }
                            const bounds = event.currentTarget.getBoundingClientRect();
                            setMenu({ x: bounds.right, y: bounds.bottom, keyboard: event.detail === 0 });
                        }} onKeyDown={event => {
                            if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
                            event.preventDefault();
                            const bounds = event.currentTarget.getBoundingClientRect();
                            setMenu({ x: bounds.right, y: bounds.bottom, keyboard: true });
                        }} />
                </Tooltip>}
            </div>
            {description && <p className="text-[11px] text-app-muted mt-1 break-words line-clamp-2">{description}</p>}
            {(version || status) && <p className="text-[10px] text-app-muted mt-1 break-words">{[version, status].filter(Boolean).join(' · ')}</p>}
            {trailing && <div className="mt-2">{trailing}</div>}
        </div>
        {menu && actions && <ContextMenu x={menu.x} y={menu.y} items={actions} onClose={closeMenu}
            autoFocus={menu.keyboard} ariaLabel={`Actions for ${name}`} />}
    </li>;
}
