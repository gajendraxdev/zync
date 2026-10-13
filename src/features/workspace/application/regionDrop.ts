import { paneContentKey, type DockPayload } from '../../../lib/paneLayout';
import type { PaneRegion } from '../../../lib/paneLayout/regions';
import { workspaceCanvases, workspacePaneForDockPayload } from '../domain/canvases';
import { deriveWorkspaceContentInventory } from '../domain/contentInventory';
import { hiddenContentIds, isPresentationScopeId } from '../domain/contentPresentation';
import { parseWorkspaceDocking, planWorkspaceDockMove } from '../domain/docking';
import type { WorkspaceViewRegistry } from '../domain/registrations';
import type { WorkspaceContentState } from '../domain/visibleContent';
import { registrationForContent } from './viewRegistrationAdapters';

export interface RegionDropState extends Pick<WorkspaceContentState, 'terminals' | 'paneLayouts' | 'contentPresentation'> {
    sessionLoaded: boolean;
    isRestoring: boolean;
    sessionPersistenceBlocked: boolean;
    workspaceDocking?: unknown;
    workspaceViewRegistry: WorkspaceViewRegistry;
}

/**
 * Shared guide/commit preflight for moving an existing resource, never creating
 * one. Resolve both drag identity and its leaf hint against fresh canonical state;
 * hidden, stale, ambiguous and disallowed sources cannot become region drops.
 */
export function workspaceRegionDropContent(state: RegionDropState, scope: string, payload: DockPayload, destination: PaneRegion): string | null {
    if (!state.sessionLoaded || state.isRestoring || state.sessionPersistenceBlocked || !isPresentationScopeId(scope)) return null;
    const parsed = parseWorkspaceDocking(state.workspaceDocking);
    if (!parsed.ok) return null;
    const terminals = Object.prototype.hasOwnProperty.call(state.terminals, scope) ? state.terminals[scope] ?? [] : [];
    const groups = Object.prototype.hasOwnProperty.call(state.paneLayouts, scope) ? state.paneLayouts[scope] : undefined;
    const canvases = workspaceCanvases(terminals, groups);
    if (new Set(canvases.map(canvas => canvas.owner)).size !== canvases.length) return null;
    const source = workspacePaneForDockPayload(canvases, payload);
    if (!source.ok || !source.pane) return null;
    const contentId = paneContentKey(source.pane.leaf.content, source.pane.leaf.id);
    const hidden = hiddenContentIds(deriveWorkspaceContentInventory(terminals, groups), state.contentPresentation?.[scope]);
    if (hidden.has(contentId)) return null;
    const registration = registrationForContent(state.workspaceViewRegistry, source.pane.leaf.content);
    const allowed = destination === 'workspace' ? ['workspace'] as const : registration?.allowedLocations ?? [];
    const plan = planWorkspaceDockMove(canvases.map(canvas => canvas.layout),
        new Map(Object.entries(parsed.value[scope]?.placements ?? {})), contentId, destination, allowed);
    return plan.ok ? contentId : null;
}
