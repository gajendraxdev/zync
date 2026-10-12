import { PanelBottom, PanelLeft, PanelRight, PanelsTopLeft } from 'lucide-react';
import type { DockedPaneRegion } from '../../features/workspace/domain/docking';
import { cn } from '../../lib/utils';

/** Shared, decorative allocation marker. Accessible names and Zync tooltips belong
 * to the containing tab/header; this adds no extra keyboard stop or native title. */
export function DockIndicator({ regions, focused = false }: { regions: readonly DockedPaneRegion[]; focused?: boolean }) {
    const Icon = regions.length !== 1 ? PanelsTopLeft : {
        'primary-sidebar': PanelLeft, 'secondary-sidebar': PanelRight, 'bottom-panel': PanelBottom,
    }[regions[0]];
    return <span data-dock-indicator data-dock-focused={focused} aria-hidden="true"
        className={cn('inline-flex shrink-0', focused ? 'text-app-accent' : 'text-app-muted')}><Icon size={12} /></span>;
}
