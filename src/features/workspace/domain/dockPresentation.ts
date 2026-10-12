import type { DockedPaneRegion } from './docking';

export const DOCK_REGION_LABELS: Record<DockedPaneRegion, string> = {
    'primary-sidebar': 'left', 'secondary-sidebar': 'right', 'bottom-panel': 'bottom',
};

export interface DockTabPresentation {
    regions: DockedPaneRegion[];
    label: string;
    description: string;
    focused: boolean;
}

/** Describe visible tab members from validated placements; never promote dormant
 * assignments or confuse a mixed center/dock group with a focus-only dock tab. */
export function describeDockedTab(ids: readonly string[], placements: Readonly<Record<string, DockedPaneRegion>>, focus?: string | null): DockTabPresentation | undefined {
    const docked = ids.filter(id => placements[id]);
    if (!docked.length) return undefined;
    const regions = (Object.keys(DOCK_REGION_LABELS) as DockedPaneRegion[]).filter(region => docked.some(id => placements[id] === region));
    const fullyDocked = docked.length === ids.length;
    const label = `${fullyDocked ? 'Docked' : 'Includes panes docked'} ${regions.map(region => DOCK_REGION_LABELS[region]).join(' / ')}`;
    return { regions, label, focused: fullyDocked && docked.includes(focus ?? ''),
        description: `${label}. Docked panes stay visible across tabs.${fullyDocked ? ' Click to focus.' : ''}` };
}
