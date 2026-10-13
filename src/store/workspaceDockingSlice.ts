import type { StateCreator } from 'zustand';
import type { AppStore } from './useAppStore';
import { collectLeaves, focusPane as focusPaneInLayout, isTermContent, layoutActiveTermId, paneContentKey, projectVisiblePaneLayout } from '../lib/paneLayout';
import { normalizePaneRegionSizes, PANE_REGION_SIZE_RULES, type PaneRegion, type PaneRegionSizes } from '../lib/paneLayout/regions';
import { findWorkspacePane, workspaceCanvases } from '../features/workspace/domain/canvases';
import { parseWorkspaceDocking, planWorkspaceDockMove, withoutWorkspaceDocking, workspaceDockingCapacity, type DockedPaneRegion, type WorkspaceDockingMap } from '../features/workspace/domain/docking';
import { isPresentationScopeId } from '../features/workspace/domain/contentPresentation';
import { hiddenWorkspaceContent } from '../features/workspace/domain/visibleContent';
import { registrationForContent } from '../features/workspace/application/viewRegistrationAdapters';
import { scheduleSaveSession } from './sessionSlice';
import { workspaceRegionDropContent } from '../features/workspace/application/regionDrop';
import type { DockPayload } from '../lib/paneLayout';
import { workspaceDockingView, type WorkspaceCanvasSelection } from '../features/workspace/domain/dockingView';
import type { MaximizedWorkspacePane } from '../features/workspace/domain/dockingProjection';

export interface WorkspaceDockingSlice {
    /** Allocation preferences only. Canonical terminals/pane groups own resources. */
    workspaceDocking: WorkspaceDockingMap;
    /** Non-persistent exact content identity; does not change the selected center. */
    workspaceDockFocus: Record<string, string | null>;
    /** Session-local geometry, excluded from saved sessions. */
    maximizedWorkspacePanes: Record<string, MaximizedWorkspacePane | undefined>;
    maximizeWorkspacePane: (scope: string, contentId: string, selection?: WorkspaceCanvasSelection) => boolean;
    /** Expected request prevents stale renderer cleanup from clearing a newer action. */
    restoreWorkspacePane: (scope: string, expected?: MaximizedWorkspacePane) => void;
    moveWorkspaceContent: (scope: string, contentId: string, destination: PaneRegion) => boolean;
    /** Move a freshly resolved drag source through the same allocation path; return its identity on acceptance. */
    dropWorkspaceContent: (scope: string, payload: DockPayload, destination: PaneRegion) => string | null;
    focusWorkspaceContent: (scope: string, contentId: string) => boolean;
    clearWorkspaceDockFocus: (scope: string) => void;
    /** Post-close cleanup only; live/dormant unaddressed content is preserved. Caller saves. */
    forgetClosedWorkspaceDocking: (scope: string, contentIds: readonly string[]) => void;
    setWorkspaceDockSizes: (scope: string, sizes: PaneRegionSizes) => boolean;
    /** Commit one still-occupied region; merge into current sizes, never a stale UI snapshot. */
    resizeWorkspaceDockRegion: (scope: string, region: DockedPaneRegion, size: number) => boolean;
    /** Explicit recovery restores allocation only; never closes or reveals content. */
    resetWorkspaceDocking: (scope: string) => boolean;
}

/** Resolve an exact live identity without silently deduplicating ambiguous ownership. */
function canvasesFor(state: AppStore, scope: string) {
    const own = (record: object) => Object.prototype.hasOwnProperty.call(record, scope);
    return workspaceCanvases(own(state.terminals) ? state.terminals[scope] ?? [] : [],
        own(state.paneLayouts) ? state.paneLayouts[scope] : undefined);
}

function locate(state: AppStore, scope: string, contentId: string) {
    return findWorkspacePane(canvasesFor(state, scope), { contentId });
}

function writable(state: AppStore, scope: string): boolean {
    return state.sessionLoaded && !state.isRestoring && !state.sessionPersistenceBlocked && isPresentationScopeId(scope);
}

/** Host-only metadata and focus actions; no open/close, IPC or permission capability. */
export const createWorkspaceDockingSlice: StateCreator<AppStore, [], [], WorkspaceDockingSlice> = (set, get) => {
    const write = (state: AppStore, candidate: WorkspaceDockingMap): boolean => {
        const parsed = parseWorkspaceDocking(candidate);
        if (!parsed.ok) return false;
        if (JSON.stringify(parsed.value) === JSON.stringify(state.workspaceDocking)) return true;
        set({ workspaceDocking: parsed.value });
        void get().saveSession();
        return true;
    };
    return {
        workspaceDocking: {}, workspaceDockFocus: {}, maximizedWorkspacePanes: {},
        maximizeWorkspacePane: (scope, contentId, selection = {}) => {
            const state = get();
            const tab = state.tabs.find(item => item.id === state.activeTabId);
            if (!isPresentationScopeId(scope) || !state.sessionLoaded || state.isRestoring || state.showWelcomeScreen
                || tab?.type !== 'connection' || tab.connectionId !== scope || state.activeConnectionId !== scope) return false;
            const view = workspaceDockingView({ ...state, maximizedWorkspacePanes: {} }, scope, selection);
            if (!view.projection.ok) return false;
            const visible = Object.values(view.projection.value.regions).flatMap(allocations => allocations.flatMap(({ layout }) =>
                collectLeaves(layout.root).map(leaf => paneContentKey(leaf.content, leaf.id))));
            if (visible.length < 2 || !visible.includes(contentId)) return false;
            if (!state.focusWorkspaceContent(scope, contentId)) return false;
            const current = get();
            if (current.activeTabId !== state.activeTabId || current.activeConnectionId !== scope) return false;
            const focused = workspaceDockingView({ ...current, maximizedWorkspacePanes: {} }, scope, selection);
            if (!focused.projection.ok || focused.projection.value.focusedContentId !== contentId) return false;
            set({ maximizedWorkspacePanes: { ...current.maximizedWorkspacePanes,
                [scope]: { contentId, selectedOwner: focused.selectedOwner ?? null } } });
            return true;
        },
        restoreWorkspacePane: (scope, expected) => {
            const current = get().maximizedWorkspacePanes[scope];
            if (!current || (expected && current !== expected)) return;
            set(state => {
                const next = { ...state.maximizedWorkspacePanes }; delete next[scope];
                return { maximizedWorkspacePanes: next };
            });
        },
        dropWorkspaceContent: (scope, payload, destination) => {
            const contentId = workspaceRegionDropContent(get(), scope, payload, destination);
            return contentId && get().moveWorkspaceContent(scope, contentId, destination) ? contentId : null;
        },
        moveWorkspaceContent: (scope, contentId, destination) => {
            const state = get();
            if (!writable(state, scope)) return false;
            const parsed = parseWorkspaceDocking(state.workspaceDocking);
            const target = locate(state, scope, contentId);
            if (!parsed.ok || !target) return false;
            const registration = registrationForContent(state.workspaceViewRegistry, target.leaf.content);
            // Returning existing content to the workspace stays possible when a
            // plugin is missing. Moving it elsewhere requires a live declaration.
            const allowed = destination === 'workspace' ? ['workspace'] as const : registration?.allowedLocations ?? [];
            const plan = planWorkspaceDockMove(canvasesFor(state, scope)
                .map(canvas => canvas.layout), new Map(Object.entries(parsed.value[scope]?.placements ?? {})), contentId, destination, allowed);
            if (!plan.ok) return false;
            const placements = Object.fromEntries([...plan.assignments].filter((entry): entry is [string, Exclude<PaneRegion, 'workspace'>] => entry[1] !== 'workspace'));
            return write(state, { ...parsed.value, [scope]: { ...parsed.value[scope], version: 1, placements } });
        },
        clearWorkspaceDockFocus: scope => {
            if (get().workspaceDockFocus[scope]) set(state => ({ workspaceDockFocus: { ...state.workspaceDockFocus, [scope]: null } }));
        },
        forgetClosedWorkspaceDocking: (scope, contentIds) => {
            const state = get();
            const live = new Set(canvasesFor(state, scope).flatMap(canvas => collectLeaves(canvas.layout.root)
                .map(leaf => paneContentKey(leaf.content, leaf.id))));
            const closed = new Set(contentIds.filter(id => !live.has(id)));
            const maximized = state.maximizedWorkspacePanes[scope];
            if (maximized && closed.has(maximized.contentId)) get().restoreWorkspacePane(scope, maximized);
            const focused = state.workspaceDockFocus[scope];
            const focusPatch = focused && closed.has(focused)
                ? { workspaceDockFocus: { ...state.workspaceDockFocus, [scope]: null } } : {};
            const parsed = parseWorkspaceDocking(state.workspaceDocking);
            if (!writable(state, scope) || !parsed.ok || !parsed.value[scope]) {
                if ('workspaceDockFocus' in focusPatch) set(focusPatch);
                return;
            }
            const preferences = parsed.value[scope];
            const placements = Object.fromEntries(Object.entries(preferences.placements).filter(([id]) => !closed.has(id)));
            if (Object.keys(placements).length === Object.keys(preferences.placements).length) {
                if ('workspaceDockFocus' in focusPatch) set(focusPatch);
                return;
            }
            // Removing known keys cannot expand authority; the parser keeps empty
            // scopes normalized and refuses to overwrite unknown future metadata.
            const candidate = withoutWorkspaceDocking(parsed.value, scope, closed);
            if (candidate.ok) set({ workspaceDocking: candidate.value, ...focusPatch });
        },
        focusWorkspaceContent: (scope, contentId) => {
            const state = get();
            const parsed = parseWorkspaceDocking(state.workspaceDocking);
            const target = locate(state, scope, contentId);
            if (!isPresentationScopeId(scope) || !parsed.ok || !target || hiddenWorkspaceContent(state, scope).has(contentId)) return false;
            const canvases = canvasesFor(state, scope);
            if (new Set(canvases.map(canvas => canvas.owner)).size !== canvases.length
                || !workspaceDockingCapacity(canvases.map(canvas => canvas.layout), new Map(Object.entries(parsed.value[scope]?.placements ?? {}))).ok) return false;
            if (parsed.value[scope]?.placements[contentId]) {
                if (state.workspaceDockFocus[scope] !== contentId) set({ workspaceDockFocus: { ...state.workspaceDockFocus, [scope]: contentId } });
                return true;
            }
            const next = focusPaneInLayout(target.layout, target.leaf.id);
            const termId = layoutActiveTermId(projectVisiblePaneLayout(next, hiddenWorkspaceContent(state, scope)));
            const owned = Boolean(state.paneLayouts[scope]?.[target.owner]);
            const activeTerm = termId ?? (isTermContent(target.leaf.content) ? target.leaf.content.termId : state.activeTerminalIds[scope]);
            if (!state.workspaceDockFocus[scope] && state.activePaneGroupOwner[scope] === (owned ? target.owner : null)
                && state.activeTerminalIds[scope] === activeTerm && target.layout.activePaneId === target.leaf.id) return true;
            set({
                workspaceDockFocus: { ...state.workspaceDockFocus, [scope]: null },
                activePaneGroupOwner: { ...state.activePaneGroupOwner, [scope]: owned ? target.owner : null },
                activeTerminalIds: { ...state.activeTerminalIds, [scope]: activeTerm ?? null },
                ...(owned && { paneLayouts: { ...state.paneLayouts, [scope]: { ...state.paneLayouts[scope], [target.owner]: next } } }),
            });
            scheduleSaveSession(() => get().saveSession());
            return true;
        },
        setWorkspaceDockSizes: (scope, sizes) => {
            const state = get(); const parsed = parseWorkspaceDocking(state.workspaceDocking);
            if (!writable(state, scope) || !parsed.ok) return false;
            return write(state, { ...parsed.value, [scope]: { ...(parsed.value[scope] ?? { version: 1, placements: {} }), sizes } });
        },
        resizeWorkspaceDockRegion: (scope, region, size) => {
            const state = get(); const parsed = parseWorkspaceDocking(state.workspaceDocking);
            if (!writable(state, scope) || !parsed.ok || !Object.prototype.hasOwnProperty.call(PANE_REGION_SIZE_RULES, region)) return false;
            const rule = PANE_REGION_SIZE_RULES[region];
            if (!Number.isFinite(size) || size < rule.min || size > rule.max) return false;
            const preferences = parsed.value[scope];
            if (!preferences) return false;
            const canvases = canvasesFor(state, scope);
            const hidden = hiddenWorkspaceContent(state, scope);
            if (new Set(canvases.map(canvas => canvas.owner)).size !== canvases.length
                || !workspaceDockingCapacity(canvases.map(canvas => canvas.layout), new Map(Object.entries(preferences.placements))).ok
                || !canvases.some(canvas => collectLeaves(canvas.layout.root).some(leaf => {
                    const id = paneContentKey(leaf.content, leaf.id);
                    return preferences.placements[id] === region && !hidden.has(id);
                }))) return false;
            const current = normalizePaneRegionSizes(preferences.sizes);
            if (current[rule.key] === size) return true;
            return write(state, { ...parsed.value, [scope]: { ...preferences, sizes: { ...current, [rule.key]: size } } });
        },
        resetWorkspaceDocking: scope => {
            const state = get(); const parsed = parseWorkspaceDocking(state.workspaceDocking);
            if (!writable(state, scope) || !parsed.ok) return false;
            const next = { ...parsed.value }; delete next[scope];
            if (!write(state, next)) return false;
            get().clearWorkspaceDockFocus(scope);
            get().restoreWorkspacePane(scope);
            return true;
        },
    };
};
