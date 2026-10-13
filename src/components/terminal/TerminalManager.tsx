
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { PaneSurfaceLayer } from '../workspace/PaneSurfaceLayer';
import { workspaceDockingSurfaces } from '../workspace/workspaceDockingSurfaces';
import { WorkspaceDockingFrame } from '../workspace/WorkspaceDockingFrame';
import { WorkspaceRegionDropTargets } from '../workspace/WorkspaceRegionDropTargets';
import { workspaceDockingView, projectWorkspaceDockingView } from '../../features/workspace/domain/dockingView';
import { parseWorkspaceDocking } from '../../features/workspace/domain/docking';
import type { WorkspaceDockingProjection } from '../../features/workspace/domain/dockingProjection';
import { usePaneSurfaceGeometry } from '../workspace/usePaneSurfaceGeometry';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Terminal as TerminalIcon, Plus, X, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';
import { once, type UnlistenFn } from '@tauri-apps/api/event';
import { queueTerminalInput } from '../../lib/terminal/inputPipeline';
import { implicitTerminalTarget } from '../../features/workspace/domain/visibleContent';
import { findLayoutOwner, projectVisiblePaneLayout } from '../../lib/paneLayout';
import { PaneLayoutView } from './PaneLayoutView';
import { PaneLeafView } from './PaneLeafView';
import type { DockTabPointerHandlers } from '../layout/tabDock';
import { Button } from '../ui/Button';
import { listenWorkspacePresentationActions } from '../../features/shortcuts/workspacePresentation';

// TerminalTab interface is now in store/terminalSlice
// export interface TerminalTab ... removed

const EMPTY_HIDDEN_CONTENT: ReadonlySet<string> = new Set();
const EMPTY_DOCK_PROJECTION: WorkspaceDockingProjection = {
    regions: { workspace: [], 'primary-sidebar': [], 'secondary-sidebar': [], 'bottom-panel': [] }, focusedContentId: null,
};

export function TerminalManager({
    connectionId,
    isVisible,
    isWorkspaceActive,
    isTerminalView = true,
    hideTabs = false,
    dockPointer,
    featureInstanceId,
    pluginPanelId,
    featureView,
    hiddenContentIds = EMPTY_HIDDEN_CONTENT,
    hiddenContentFallback,
}: {
    connectionId?: string;
    isVisible?: boolean;
    /** Sidebar workspace tab is selected (false when another host/local tab is active). */
    isWorkspaceActive?: boolean;
    /** This workspace is showing the terminal view (false on Files/Dashboard). */
    isTerminalView?: boolean;
    hideTabs?: boolean;
    dockPointer?: DockTabPointerHandlers;
    /** Ungrouped Files/Dashboard tab: show that pane in this canvas, not an overlay. */
    featureInstanceId?: string;
    /** A plugin view selects its own canvas, never the last active shell's canvas. */
    pluginPanelId?: string;
    /** Kind fallback for restored legacy feature panes without an instance ID. */
    featureView?: import('../../lib/paneLayout').SplitFeatureId;
    /** Presentation-only hidden identities; canonical layouts still own their content. */
    hiddenContentIds?: ReadonlySet<string>;
    /** Reachable recovery for a selected canvas whose panes are all hidden. */
    hiddenContentFallback?: ReactNode;
}) {
    const workspaceActive = isWorkspaceActive ?? (isVisible !== false);
    const terminalView = isTerminalView ?? (isVisible !== false);
    const panelVisible = workspaceActive && terminalView;
    const globalActiveId = useAppStore(state => state.activeConnectionId);
    const activeConnectionId = connectionId || globalActiveId;

    // Zustand Store Hooks - Optimized
    const tabs = useAppStore(useShallow(state =>
        activeConnectionId
            ? (state.terminals[activeConnectionId] || []).filter(tab => tab.tabVisible !== false)
            : [],
    ));
    const activeTabId = useAppStore(state => activeConnectionId ? (state.activeTerminalIds[activeConnectionId] || null) : null);
    const paneGroups = useAppStore((state) =>
        activeConnectionId ? state.paneLayouts[activeConnectionId] : undefined
    );
    const visibleActiveTabId = activeTabId
        ? (findLayoutOwner(paneGroups, activeTabId) ?? activeTabId)
        : null;
    // Subscribe to this connection's resources, not terminal output or unrelated UI
    // state. All canvases feed one allocation and one stable retained host layer.
    const dockingInputs = useAppStore(useShallow(state => ({
        terminals: activeConnectionId ? state.terminals[activeConnectionId] : undefined,
        owner: activeConnectionId ? state.activePaneGroupOwner[activeConnectionId] : undefined,
        presentation: activeConnectionId ? state.contentPresentation[activeConnectionId] : undefined,
        focus: activeConnectionId ? state.workspaceDockFocus[activeConnectionId] : undefined,
        maximized: activeConnectionId ? state.maximizedWorkspacePanes[activeConnectionId] : undefined,
        preferences: state.workspaceDocking,
    })));
    // Preferences are immutable store snapshots. Validate the complete envelope
    // only when it changes, not for terminal titles, focus or center selection.
    const dockingPreferences = useMemo(() => parseWorkspaceDocking(dockingInputs.preferences), [dockingInputs.preferences]);
    const view = useMemo(() => {
        const scope = activeConnectionId ?? '';
        // Derive from the subscribed render snapshot, not a newer imperative
        // store read that could disagree with this render's selection/resources.
        return projectWorkspaceDockingView({
            terminals: { [scope]: dockingInputs.terminals ?? [] },
            paneLayouts: { [scope]: paneGroups },
            activeTerminalIds: { [scope]: activeTabId },
            activePaneGroupOwner: { [scope]: dockingInputs.owner ?? null },
            contentPresentation: dockingInputs.presentation ? { [scope]: dockingInputs.presentation } : {},
            workspaceDockFocus: { [scope]: dockingInputs.focus ?? null },
            maximizedWorkspacePanes: { [scope]: dockingInputs.maximized },
        }, scope, dockingPreferences, {
        featureInstanceId, pluginPanelId, featureId: featureView,
        }, hiddenContentIds);
    }, [activeConnectionId, paneGroups, activeTabId, dockingInputs, dockingPreferences, featureInstanceId, pluginPanelId, featureView, hiddenContentIds]);
    const projection = view.projection.ok ? view.projection.value : EMPTY_DOCK_PROJECTION;
    const allCanvasesHidden = useMemo(() => {
        const hidden = new Set(hiddenContentIds);
        for (const [id, preferences] of Object.entries(dockingInputs.presentation?.items ?? {})) {
            if (preferences.hidden) hidden.add(id);
        }
        return view.canvases.length > 0 && view.canvases.every(({ layout }) => !projectVisiblePaneLayout(layout, hidden));
    }, [view.canvases, hiddenContentIds, dockingInputs.presentation]);
    const surfaces = useMemo(() => workspaceDockingSurfaces(view.canvases, projection, panelVisible), [view, projection, panelVisible]);
    const focusWorkspaceContent = useAppStore(state => state.focusWorkspaceContent);
    const resetWorkspaceDocking = useAppStore(state => state.resetWorkspaceDocking);
    const restoreWorkspacePane = useAppStore(state => state.restoreWorkspacePane);
    // Restore immediately in projection, then discard stale requests. Comparing
    // the captured object prevents cleanup from cancelling a newer maximize.
    // Unmount also releases its request without retaining closed workspace scopes.
    useEffect(() => {
        const request = dockingInputs.maximized;
        if (!activeConnectionId || !request) return;
        if (!panelVisible || !projection.maximizedContentId) restoreWorkspacePane(activeConnectionId, request);
        return () => restoreWorkspacePane(activeConnectionId, request);
    }, [activeConnectionId, dockingInputs.maximized, panelVisible, projection.maximizedContentId, restoreWorkspacePane]);
    useEffect(() => {
        if (!activeConnectionId || !panelVisible) return;
        return listenWorkspacePresentationActions(useAppStore.getState,
            target => target.action === 'maximize-pane' && target.connectionId === activeConnectionId,
            () => {
                const state = useAppStore.getState();
                const selection = { featureInstanceId, pluginPanelId, featureId: featureView };
                const current = workspaceDockingView(state, activeConnectionId, selection);
                if (current.projection.ok && current.projection.value.maximizedContentId) state.restoreWorkspacePane(activeConnectionId);
                else {
                    const id = current.projection.ok ? current.projection.value.focusedContentId : null;
                    if (!id || !state.maximizeWorkspacePane(activeConnectionId, id, selection)) {
                        state.showToast('info', 'Open at least two visible panes to maximize one.');
                    }
                }
            });
    }, [activeConnectionId, panelVisible, featureInstanceId, pluginPanelId, featureView]);
    const canResetDocking = useAppStore(state => state.sessionLoaded && !state.isRestoring && !state.sessionPersistenceBlocked);

    // Actions (stable)
    const createTerminal = useAppStore(state => state.createTerminal);
    const closeTerminalGroup = useAppStore(state => state.closeTerminalGroup);
    const setActiveTerminal = useAppStore(state => state.setActiveTerminal);
    const terminalTransparencyEnabled = useAppStore(
        state => state.settings.enableVibrancy && (state.settings.windowOpacity ?? 1) < 1
    );
    const terminalContentRef = useRef<HTMLDivElement>(null);
    const { registerSlot, registerHost } = usePaneSurfaceGeometry(terminalContentRef);
    const pendingReadyRef = useRef<Record<string, { timeoutId: any; unlistenFn?: UnlistenFn; sent?: boolean }>>({});


    const handleNewTab = () => {
        if (activeConnectionId) {
            createTerminal(activeConnectionId);
        }
    };


    // Event Listener for external commands (Snippets)
    useEffect(() => {
        const handleRunCommand = (e: any) => {
            const { connectionId: targetConnId, command } = e.detail;
            const target = activeConnectionId && implicitTerminalTarget(useAppStore.getState(), activeConnectionId);
            if (targetConnId === activeConnectionId && target) {
                queueTerminalInput(target, command);
            }
        };

        const handleTriggerNewTab = (e: any) => {
            const { connectionId: targetConnId, command } = e.detail;
            if (targetConnId === activeConnectionId && activeConnectionId) {
                // `createTerminal` takes only `connectionId` and returns the newly created `termId`.
                const newId = createTerminal(activeConnectionId);
                if (!newId) return;

                // If a command was passed (e.g., from a plugin like PM2 logs), execute it in the new tab after it's ready
                if (command) {
                    const pendingObj: { timeoutId: any; unlistenFn?: UnlistenFn; sent?: boolean } = {
                        sent: false,
                        timeoutId: setTimeout(() => {
                            const obj = pendingReadyRef.current[newId];
                            if (!obj || obj.sent) return;

                            obj.sent = true;
                            obj.unlistenFn?.(); // Clean up listener on timeout
                            delete pendingReadyRef.current[newId];

                            console.warn(`[TerminalManager] terminal-ready-${newId} timed out, sending command anyway`);
                            queueTerminalInput(newId, command);
                        }, 5000)
                    };
                    pendingReadyRef.current[newId] = pendingObj;

                    once(`terminal-ready-${newId}`, () => {
                        const obj = pendingReadyRef.current[newId];
                        if (obj && !obj.sent) {
                            obj.sent = true;
                            clearTimeout(obj.timeoutId);
                            delete pendingReadyRef.current[newId];
                            queueTerminalInput(newId, command);
                        }
                    }).then(unlisten => {
                        const obj = pendingReadyRef.current[newId];
                        if (obj) {
                            obj.unlistenFn = unlisten;
                        } else {
                            // Already timed out or handled
                            unlisten();
                        }
                    }).catch(err => {
                        console.error(`[TerminalManager] Failed to listen for terminal-ready-${newId}:`, err);
                    });

                    // Automatically switch the global Zync view to 'terminal' so the user sees the logs
                    const activeGlobalTabId = useAppStore.getState().activeTabId;
                    if (activeGlobalTabId) {
                        useAppStore.getState().setTabView(activeGlobalTabId, 'terminal');
                    }
                }
            }
        };

        const handleTriggerCloseTab = (e: any) => {
            const { connectionId: targetConnId } = e.detail;
            const currentActiveTabId = activeConnectionId && implicitTerminalTarget(useAppStore.getState(), activeConnectionId);
            if (targetConnId === activeConnectionId && currentActiveTabId) {
                const store = useAppStore.getState();
                const owner = findLayoutOwner(
                    store.paneLayouts[activeConnectionId!],
                    currentActiveTabId,
                ) ?? currentActiveTabId;
                store.closeTerminalGroup(activeConnectionId!, owner);
            }
        };

        const handlePluginTerminalSend = (e: any) => {
            const { connectionId: targetConnId, text } = (e as CustomEvent).detail;
            // If the plugin didn't provide a connectionId, or it matches ours, and we have an active terminal
            const state = useAppStore.getState();
            // Unaddressed sends belong only to the active workspace, not every retained host.
            const addressedHere = targetConnId ? targetConnId === activeConnectionId : state.activeConnectionId === activeConnectionId;
            const target = activeConnectionId && implicitTerminalTarget(state, activeConnectionId);
            if (addressedHere && target) {
                queueTerminalInput(target, text);
            }
        };

        window.addEventListener('ssh-ui:run-command', handleRunCommand);
        window.addEventListener('ssh-ui:new-terminal-tab', handleTriggerNewTab);
        window.addEventListener('ssh-ui:close-terminal-tab', handleTriggerCloseTab);
        window.addEventListener('zync:terminal:send', handlePluginTerminalSend);

        return () => {
            window.removeEventListener('ssh-ui:run-command', handleRunCommand);
            window.removeEventListener('ssh-ui:new-terminal-tab', handleTriggerNewTab);
            window.removeEventListener('ssh-ui:close-terminal-tab', handleTriggerCloseTab);
            window.removeEventListener('zync:terminal:send', handlePluginTerminalSend);

            // Clear any pending timeouts and reset pendingReadyRef
            Object.values(pendingReadyRef.current).forEach(obj => {
                if (obj) {
                    if (typeof obj.unlistenFn === 'function') {
                        obj.unlistenFn();
                    }
                    if (obj.timeoutId) {
                        clearTimeout(obj.timeoutId);
                    }
                }
            });
            pendingReadyRef.current = {};

            // Cleanup only if connection changed or unmounting
            // We don't want to clear this when just switching tabs within same connection
        };
    }, [activeConnectionId]); // Remove activeTabId to prevent reset on tab switch


    const handleCloseTab = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (activeConnectionId) {
            closeTerminalGroup(activeConnectionId, id);
        }
    };


    if (!activeConnectionId) {
        return (
            <div className={cn(
                "h-full flex flex-col items-center justify-center text-app-muted",
                terminalTransparencyEnabled ? "bg-app-bg/80 backdrop-blur-xl" : "bg-app-bg"
            )}>
                <p>Select a connection to view terminals</p>
            </div>
        );
    }

    return (
        <div className={cn("flex flex-col h-full", terminalTransparencyEnabled ? "bg-transparent" : "bg-app-bg")}>
            {/* Tab Bar for Terminals - Conditionally Hidden */}
            {!hideTabs && (
                <div className="flex items-center w-full bg-app-panel border-b border-app-border px-1 h-8 shrink-0 overflow-x-auto scrollbar-hide gap-1">
                    <div className="flex-1 flex overflow-x-auto scrollbar-hide h-full items-center gap-1">
                        {tabs.map(tab => (
                            <div
                                key={tab.id}
                                onClick={() => activeConnectionId && setActiveTerminal(activeConnectionId, tab.id)}

                                className={cn(
                                    "flex items-center gap-1.5 px-2 py-0.5 h-6 text-[11px] font-medium rounded-sm transition-all cursor-pointer min-w-[80px] max-w-[160px] group select-none shrink-0 border",
                                    visibleActiveTabId === tab.id
                                        ? "bg-app-surface border-app-border/50 text-app-text shadow-sm"
                                        : "bg-transparent border-transparent text-app-muted hover:bg-app-surface/50 hover:text-app-text"
                                )}
                            >
                                {tab.isSynced ? (
                                    <Zap size={11} className="text-yellow-500 fill-yellow-500/20" />
                                ) : (
                                    <TerminalIcon size={11} className={cn(visibleActiveTabId === tab.id ? "text-app-accent" : "text-app-muted group-hover:text-app-text opacity-70 group-hover:opacity-100")} />
                                )}
                                <span className="truncate flex-1">{tab.title}</span>
                                <button
                                    onClick={(e) => handleCloseTab(tab.id, e)}
                                    className="opacity-0 group-hover:opacity-100 hover:bg-app-bg p-0.5 rounded text-app-muted hover:text-red-400 transition-all"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <button
                        onClick={handleNewTab}
                        className="h-6 w-6 flex items-center justify-center rounded text-app-muted hover:text-white hover:bg-app-surface transition-colors"
                        title="New Terminal Tab"
                    >
                        <Plus size={14} />
                    </button>
                </div>
            )}

            {/* Terminal Content Area */}
            <div ref={terminalContentRef} className={cn("flex-1 overflow-hidden relative", terminalTransparencyEnabled ? "bg-transparent" : "bg-app-bg")}>
                <div className={cn('absolute inset-0', !panelVisible && 'hidden')}>
                    {view.projection.ok ? <WorkspaceDockingFrame key={activeConnectionId} projection={projection} sizes={view.preferences?.sizes}
                        onResize={canResetDocking && panelVisible ? (region, size) => useAppStore.getState().resizeWorkspaceDockRegion(activeConnectionId, region, size) : undefined}
                        onResizeRefused={() => useAppStore.getState().showToast('warning', 'This region could not be resized. It may have closed or workspace saving may be unavailable.')}
                        renderAllocation={allocation => <PaneLayoutView connectionId={activeConnectionId}
                            layout={allocation.layout} layoutOwner={allocation.owner} registerSlot={registerSlot} />}
                        emptyWorkspace={<div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-app-muted">
                            {pluginPanelId && !view.selectedOwner ? <span role="status">Preparing plugin pane...</span>
                                : allCanvasesHidden && hiddenContentFallback ? hiddenContentFallback : <>
                                <span>{view.canvases.length ? 'No panes in the center workspace. Select a tab or right-click the tab bar for pane actions.' : 'No active terminals'}</span>
                                {!view.canvases.length && <Button variant="secondary" onClick={handleNewTab}>Open New Terminal</Button>}
                            </>}
                        </div>} /> : <div role="status" className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-sm text-app-muted">
                        <span>This saved docking layout cannot be displayed. Your panes have not been closed.</span>
                        {view.projection.reason !== 'unsupported-docking' && <Button variant="secondary" disabled={!canResetDocking}
                            onClick={() => {
                                if (!resetWorkspaceDocking(activeConnectionId)) useAppStore.getState().showToast('warning', 'Docking settings could not be reset. Check that workspace saving is available.');
                            }}>Reset docking locations</Button>}
                    </div>}
                </div>
                <PaneSurfaceLayer
                    key={activeConnectionId}
                    surfaces={surfaces}
                    registerHost={registerHost}
                    renderSurface={surface => (
                        <PaneLeafView
                            connectionId={activeConnectionId}
                            node={surface.node}
                            layout={surface.layout}
                            focusedPaneId={surface.focusedPaneId}
                            focused={surface.focused}
                            dockRegion={view.preferences?.placements[surface.key]}
                            onFocusContent={() => focusWorkspaceContent(activeConnectionId, surface.key)}
                            split={surface.split}
                            edges={surface.edges}
                            workspaceActive={workspaceActive}
                            panelVisible={surface.visible}
                            dockPointer={dockPointer}
                            maximized={projection.maximizedContentId === surface.key}
                            onToggleMaximize={() => {
                                const state = useAppStore.getState();
                                if (projection.maximizedContentId === surface.key) state.restoreWorkspacePane(activeConnectionId);
                                else if (!state.maximizeWorkspacePane(activeConnectionId, surface.key,
                                    { featureInstanceId, pluginPanelId, featureId: featureView })) {
                                    state.showToast('info', 'This pane can no longer be maximized.');
                                }
                            }}
                        />
                    )}
                />
                {view.projection.ok && panelVisible && canResetDocking && dockPointer &&
                    <WorkspaceRegionDropTargets scope={activeConnectionId} contextId={dockPointer.contextId}
                        projection={projection} sizes={view.preferences?.sizes} />}
            </div>
        </div>
    );
}
