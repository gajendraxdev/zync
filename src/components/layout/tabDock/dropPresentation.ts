import type { PaneRegion } from '../../../lib/paneLayout/regions';
import type { DockTarget } from './hit';

/** Shared, kind-agnostic copy distinguishes a persistent allocation from a tab-group split. */
export function regionDropPresentation(region: PaneRegion) {
    const title = {
        workspace: 'Return to workspace', 'primary-sidebar': 'Dock left',
        'secondary-sidebar': 'Dock right', 'bottom-panel': 'Dock bottom',
    }[region];
    return { mode: region === 'workspace' ? 'workspace' as const : 'dock' as const,
        title, detail: region === 'workspace' ? 'Return to its workspace tab' : 'Stays visible across tabs' };
}

export function dockTargetPresentation(target: DockTarget) {
    if (target.kind === 'region') return regionDropPresentation(target.region);
    return { mode: 'split' as const, title: `Split ${target.edge}`, detail: 'Group panes in this tab' };
}
