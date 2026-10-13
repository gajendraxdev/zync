import type { ReactNode } from 'react';
import type { DockTabPresentation } from '../../features/workspace/domain/dockPresentation';
import { DockIndicator } from '../workspace/DockIndicator';

/** Native selection control; its click bubbles to the owning tab's guarded
 * activation handler. Close remains a sibling, never a nested button. */
export function ContentTabTrigger({ label, selected, compact = false, dock, children }: {
    label: string;
    selected: boolean;
    compact?: boolean;
    dock?: DockTabPresentation;
    children: ReactNode;
}) {
    return <button type="button" data-workspace-tab-trigger aria-label={dock ? `${label} — ${dock.label}${dock.focused ? ', focused dock' : ''}` : label} aria-pressed={selected}
        className={`inline-flex min-w-0 flex-1 items-center rounded text-left outline-none cursor-inherit focus-visible:ring-1 focus-visible:ring-app-accent ${compact ? 'gap-1.5' : 'gap-2'}`}>
        {children}
        {dock && <DockIndicator regions={dock.regions} focused={dock.focused} />}
    </button>;
}
