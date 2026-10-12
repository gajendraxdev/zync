import {
    collectLeaves,
    featurePaneContent,
    findLeafByFeature,
    layoutForCanvas,
    layoutForTerm,
    newFeatureInstanceId,
    paneContentKey,
    projectVisiblePaneLayout,
    singlePane,
    WORKSPACE_PANE_OWNER,
    type DockEdge,
    type PaneLayout,
} from '../../../lib/paneLayout';
import { useAppStore } from '../../../store/useAppStore';
import { allowsAdditionalCenterPane, allowsAdditionalPaneBeside, allowsExistingPaneBeside } from '../../../features/workspace/domain/dockingTopology';
import { findWorkspacePane, workspaceCanvases } from '../../../features/workspace/domain/canvases';
import { hiddenWorkspaceContent } from '../../../features/workspace/domain/visibleContent';
import { directoryFromFileLocation, pickFilesOpenPath, type OpenHereFile } from './openHerePaths';

export {
    directoryFromFileLocation,
    isUnconfirmedHomeToken,
    isUnresolvedFilesPath,
    parentDirectory,
    pickFilesHomePath,
    pickFilesOpenPath,
    type OpenHereFile,
} from './openHerePaths';

function toastPaneCap(): void {
    useAppStore.getState().showToast('info', 'There is no room for another pane. Move a docked pane back to the workspace or close a pane first.');
}

function layoutForConnection(connectionId: string, sourceTermId?: string) {
    const store = useAppStore.getState();
    if (sourceTermId) return layoutForTerm(store.paneLayouts[connectionId], sourceTermId)
        ?? (store.terminals[connectionId]?.some(tab => tab.id === sourceTermId)
            ? singlePane(sourceTermId, sourceTermId) : undefined);
    const activeId = store.activeTerminalIds[connectionId];
    return layoutForCanvas(store.paneLayouts[connectionId], activeId, store.activePaneGroupOwner[connectionId])
        ?? (activeId && store.terminals[connectionId]?.some(tab => tab.id === activeId)
            ? singlePane(activeId, activeId) : undefined);
}

/** Snapshot a stable target before asynchronous directory resolution. */
function filesInsertionTarget(connectionId: string, termId?: string) {
    if (termId) return { contentId: paneContentKey({ kind: 'term', termId }, termId) };
    const state = useAppStore.getState();
    if (state.workspaceDockFocus?.[connectionId]) return { contentId: state.workspaceDockFocus[connectionId]! };
    const layout = layoutForConnection(connectionId);
    if (!layout) return null;
    const pane = findLeafByFeature(layout.root, 'files')
        ?? collectLeaves(layout.root).find(leaf => leaf.id === layout.activePaneId);
    return pane ? { contentId: paneContentKey(pane.content, pane.id) } : null;
}

/** Report a missing destination separately from a destination that cannot accept a pane. */
function acceptFilesInsertionTarget(connectionId: string, target: { contentId: string } | null): target is { contentId: string } {
    if (!target) {
        useAppStore.getState().showToast('info', 'Open a terminal or select a workspace pane before opening Files in a split.');
        return false;
    }
    if (!canInsertAt(connectionId, target)) { toastPaneCap(); return false; }
    return true;
}

/** Prefer an explicitly addressed Files instance; never replace a stale instance with another one. */
function terminalInsertionTarget(connectionId: string, instanceId?: string) {
    if (instanceId) return { contentId: paneContentKey(featurePaneContent('files', instanceId), '') };
    const state = useAppStore.getState();
    const canvases = workspaceCanvases(state.terminals[connectionId] ?? [], state.paneLayouts[connectionId]);
    const dockId = state.workspaceDockFocus?.[connectionId];
    const docked = dockId ? findWorkspacePane(canvases, { contentId: dockId }) : undefined;
    if (docked?.leaf.content.kind === 'feature' && docked.leaf.content.featureId === 'files') return { contentId: dockId! };
    const layout = layoutForConnection(connectionId);
    const focused = layout && collectLeaves(layout.root).find(leaf => leaf.id === layout.activePaneId);
    const files = focused?.content.kind === 'feature' && focused.content.featureId === 'files' ? focused
        : layout && findLeafByFeature(layout.root, 'files');
    return files ? { contentId: paneContentKey(files.content, files.id) } : null;
}

function syncedTerminalForConnection(connectionId: string): string | undefined {
    const state = useAppStore.getState();
    const tabs = state.terminals[connectionId] ?? [];
    return tabs.find(tab => tab.id === state.syncedTerminalId[connectionId] && tab.isSynced)?.id
        ?? tabs.find(tab => tab.isSynced)?.id;
}

function tabStillOpen(tabId: string | null): boolean {
    if (!tabId) return false;
    return useAppStore.getState().tabs.some((tab) => tab.id === tabId);
}

function showTerminalView(tabId: string | null): void {
    if (!tabId) return;
    const state = useAppStore.getState();
    const scope = state.tabs.find(tab => tab.id === tabId)?.connectionId;
    if (!scope || !state.workspaceDockFocus?.[scope]) state.setTabView(tabId, 'terminal');
}

function reportDock(result: string): void {
    if (result === 'refused-cap') toastPaneCap();
}

async function resolveFsHome(connectionId: string): Promise<string> {
    try {
        const home = await window.ipcRenderer.invoke('fs_cwd', { connectionId });
        if (typeof home === 'string' && home.trim()) return home.trim();
    } catch {
        // Fall through.
    }
    return '';
}

function filesOpenCandidates(connectionId: string, sourceTermId?: string) {
    const store = useAppStore.getState();
    const tabs = store.terminals[connectionId] || [];
    const term = sourceTermId
        ? tabs.find((tab) => tab.id === sourceTermId)
        : tabs.find((tab) => tab.id === store.activeTerminalIds[connectionId])
            ?? tabs.find((tab) => tab.tabVisible !== false);
    const connection = store.connections.find((item) => item.id === connectionId);
    return {
        lastKnownCwd: term?.lastKnownCwd,
        initialPath: term?.initialPath,
        homePath: connection?.homePath,
    };
}

async function resolveFilesDirectory(
    connectionId: string,
    path: string,
    sourceTermId?: string,
): Promise<string> {
    const given = path.trim();
    const candidates = filesOpenCandidates(connectionId, sourceTermId);
    const picked = pickFilesOpenPath({
        lastKnownCwd: given && given !== '/' ? given : candidates.lastKnownCwd,
        initialPath: candidates.initialPath,
        homePath: candidates.homePath,
    });
    if (picked) return picked;
    const home = await resolveFsHome(connectionId);
    if (home) return home;
    return given;
}

/** Full-view Files tab, or Files docked beside the current pane. */
export async function openFilesHere(
    connectionId: string,
    path: string,
    edge?: DockEdge,
    sourceTermId?: string,
): Promise<void> {
    const store = useAppStore.getState();
    const tabId = store.activeTabId;
    const target = edge ? filesInsertionTarget(connectionId, sourceTermId) : null;
    // Resolve the directory without changing a listing; reject before file I/O.
    if (edge && !acceptFilesInsertionTarget(connectionId, target)) return;
    const resolved = await resolveFilesDirectory(connectionId, path, sourceTermId);
    if (!tabId || !tabStillOpen(tabId)) return;

    if (!edge) {
        await store.loadFiles(connectionId, resolved);
        if (!tabStillOpen(tabId)) return;
        useAppStore.getState().setTabView(tabId, 'files');
        return;
    }

    // Dock first, then navigate only the accepted Files instance. The final store
    // guard also handles topology changes while directory resolution was pending.
    if (!acceptFilesInsertionTarget(connectionId, target)) return;
    const instanceId = newFeatureInstanceId('files');
    const result = useAppStore.getState().dockInSplit(
        connectionId,
        { kind: 'feature', featureId: 'files', instanceId },
        edge,
        target,
    );
    reportDock(result);
    if (result === 'refused-cap' || result === 'no-target') return;
    const current = useAppStore.getState();
    const accepted = findWorkspacePane(workspaceCanvases(current.terminals[connectionId] ?? [], current.paneLayouts[connectionId]),
        { contentId: paneContentKey(featurePaneContent('files', instanceId), '') });
    if (!accepted) return;
    showTerminalView(tabId);
    await useAppStore.getState().loadFiles(connectionId, resolved, false, false, instanceId);
}

async function resolveSpawnDirectory(
    connectionId: string,
    path: string,
    file?: OpenHereFile | null,
    instanceId?: string,
): Promise<string> {
    // An instance-owned caller supplies its own listed path. Never fall back to
    // the unrelated default Files listing if that instance has no resolved path.
    const listed = instanceId ? '' : (useAppStore.getState().currentPath[connectionId] || '').trim();
    const fromFiles = directoryFromFileLocation(path.trim() || listed, file);
    if (fromFiles) return fromFiles;
    const home = await resolveFsHome(connectionId);
    if (home) return home;
    return '';
}

/** Open a shell at the Files location. `edge` docks it beside Files (or the focused pane). */
export async function openTerminalHere(
    connectionId: string,
    path: string,
    options?: { synced?: boolean; edge?: DockEdge; file?: OpenHereFile | null; instanceId?: string },
): Promise<void> {
    const initial = useAppStore.getState();
    const tabId = initial.activeTabId;
    if (!initial.tabs.some(tab => tab.id === tabId && tab.connectionId === connectionId)) return;
    const target = options?.edge ? terminalInsertionTarget(connectionId, options.instanceId) : null;
    let existingSyncedId = options?.synced ? syncedTerminalForConnection(connectionId) : undefined;
    const syncedVisible = () => !existingSyncedId || (useAppStore.getState().terminals[connectionId]?.some(tab => tab.id === existingSyncedId)
        && !hiddenWorkspaceContent(useAppStore.getState(), connectionId).has(paneContentKey({ kind: 'term', termId: existingSyncedId }, existingSyncedId)));
    if (!syncedVisible()) { initial.showToast('info', 'Show the synced terminal before opening it here.'); return; }
    if (options?.edge && !existingSyncedId && !(target ? canInsertAt(connectionId, target) : canAddBeside(connectionId, undefined, 2))) {
        toastPaneCap(); return;
    }
    const targetPath = await resolveSpawnDirectory(connectionId, path, options?.file, options?.instanceId);
    if (!tabStillOpen(tabId)) return;
    const store = useAppStore.getState();
    // A concurrent launch may have enrolled the synced shell while resolving
    // the directory. Reuse it; never manufacture a second synced session.
    if (options?.synced && !existingSyncedId) existingSyncedId = syncedTerminalForConnection(connectionId);
    const spawnPath = targetPath || undefined;
    if (!syncedVisible()) return;
    if (options?.edge) {
        const addressed = target ?? 'overlay:files';
        const seed = target ? undefined : featurePaneContent('files');
        const result = existingSyncedId
            ? store.dockInSplit(connectionId, { kind: 'term', termId: existingSyncedId }, options.edge, addressed, undefined, seed)
            : store.openTerminalInSplit(connectionId, options.edge, addressed,
                { initialPath: spawnPath, isSynced: options.synced }, seed);
        reportDock(result);
        if (result === 'refused-cap' || result === 'no-target') return;
        if (!existingSyncedId) { showTerminalView(tabId); return; }
        // Commit the validated move before native navigation. If navigation
        // fails, keep the accepted layout; never roll back over concurrent edits.
    }
    if (existingSyncedId) {
        if (!tabStillOpen(tabId) || !syncedVisible()) return;
        if (spawnPath) {
            try {
                await window.ipcRenderer.invoke('terminal:navigate', { termId: existingSyncedId, path: spawnPath });
            } catch (err: unknown) {
                const message = err instanceof Error ? err.message : String(err);
                store.showToast('error', `Failed to navigate synced terminal: ${message}`);
                return;
            }
            if (!tabStillOpen(tabId) || !syncedVisible()) return;
            useAppStore.getState().setTerminalCwd(connectionId, existingSyncedId, spawnPath);
        }
        if (!options?.edge) {
            const current = useAppStore.getState();
            const key = paneContentKey({ kind: 'term', termId: existingSyncedId }, existingSyncedId);
            if (current.workspaceDocking?.[connectionId]?.placements?.[key]) current.focusWorkspaceContent(connectionId, key);
            else current.setActiveTerminal(connectionId, existingSyncedId);
        }
        showTerminalView(tabId);
        return;
    }
    const created = store.createTerminal(connectionId, { initialPath: spawnPath, isSynced: options?.synced });
    if (!created) return;
    if (spawnPath) store.setTerminalCwd(connectionId, created, spawnPath);
    showTerminalView(tabId);
}

/** Mirror the store's hidden-target refusal before a multi-step shell creation. */
function canAddBeside(connectionId: string, target: PaneLayout | undefined, additional: number): boolean {
    const state = useAppStore.getState();
    const hidden = hiddenWorkspaceContent(state, connectionId);
    if (target && !projectVisiblePaneLayout(target, hidden)) return false;
    const canvases = workspaceCanvases(state.terminals[connectionId] ?? [], state.paneLayouts[connectionId]);
    if (canvases.length && !canvases.some(canvas => projectVisiblePaneLayout(canvas.layout, hidden))) return false;
    return allowsAdditionalCenterPane(state, connectionId, target, additional);
}

export function canDockHere(connectionId: string, sourceTermId?: string): boolean {
    const target = filesInsertionTarget(connectionId, sourceTermId);
    return Boolean(target && canInsertAt(connectionId, target));
}

/** Exact-target visibility and write gates precede both read-only lookups and creation. */
function canInsertAt(connectionId: string, target: { contentId: string }): boolean {
    const state = useAppStore.getState();
    if (hiddenWorkspaceContent(state, connectionId).has(target.contentId)) return false;
    if (state.workspaceDocking?.[connectionId]?.placements?.[target.contentId]
        && (!state.sessionLoaded || state.isRestoring || state.sessionPersistenceBlocked)) return false;
    return allowsAdditionalPaneBeside(state, connectionId, target);
}

/** Reserve both Files and shell for an overlay; existing canvases need one new pane. */
export function canSplitBesideFiles(connectionId: string, options?: { instanceId?: string; synced?: boolean }): boolean {
    const target = terminalInsertionTarget(connectionId, options?.instanceId);
    const synced = options?.synced ? syncedTerminalForConnection(connectionId) : undefined;
    if (target && !synced) return canInsertAt(connectionId, target);
    const state = useAppStore.getState();
    const owner = target ? findWorkspacePane(workspaceCanvases(state.terminals[connectionId] ?? [], state.paneLayouts[connectionId]), target) : undefined;
    if (target && !owner) return false;
    if (synced && target) {
        const sourceId = paneContentKey({ kind: 'term', termId: synced }, synced);
        const hidden = hiddenWorkspaceContent(state, connectionId);
        if (hidden.has(sourceId) || hidden.has(target.contentId)) return false;
        const assignments = state.workspaceDocking?.[connectionId]?.placements;
        if ((assignments?.[sourceId] || assignments?.[target.contentId])
            && (!state.sessionLoaded || state.isRestoring || state.sessionPersistenceBlocked)) return false;
        return allowsExistingPaneBeside(state, connectionId, sourceId, target.contentId);
    }
    if (synced && hiddenWorkspaceContent(state, connectionId).has(paneContentKey({ kind: 'term', termId: synced }, synced))) return false;
    const canvas = state.paneLayouts[connectionId]?.[WORKSPACE_PANE_OWNER];
    return canAddBeside(connectionId, canvas, canvas ? 1 : 2);
}
