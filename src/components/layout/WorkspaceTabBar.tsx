import { memo, useMemo, type ReactNode } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAvailableShells } from '../../hooks/useAvailableShells';
import { LOCAL_TERMINAL_CONNECTION_ID } from '../../features/connections/application/tabService';
import { CombinedTabBar } from './CombinedTabBar';
import { overlayPluginPaneId, type DockTabPointerHandlers } from './tabDock';
import type { ShellEntry } from '../../lib/shells/types';
import type { FeatureId, WorkspaceFeatureTab } from './featureMeta';
import { findWorkspaceContentPane } from '../../features/workspace/domain/contentInventory';
import { hiddenWorkspaceContent } from '../../features/workspace/domain/visibleContent';
import { createWorkspaceSplitControlsSelector, workspaceSplitTarget } from '../../features/workspace/domain/dockingView';
import { allowsAdditionalPaneBeside } from '../../features/workspace/domain/dockingTopology';
import {
    findNode,
    isFeatureContent,
    isPaneLeaf,
    isPluginContent,
    isSplitFeatureId,
    layoutForCanvas,
    layoutForPlugin,
    collectLeaves,
    paneContentKey,
    paneDockPayload,
    projectVisiblePaneLayout,
    splitFromDockEdge,
    type DockEdge,
    type SplitFeatureId,
} from '../../lib/paneLayout';

export interface WorkspaceTabBarProps {
    connectionId: string;
    tabId: string;
    activeView: string;
    featureTabs: WorkspaceFeatureTab[];
    activeFeatureTabId: string | null;
    pinnedFeatures: string[];
    pluginPanels: { id: string; title: string; allowMultiple: boolean }[];
    contentActions?: ReactNode;
    onTabSelect: (view: string, termId?: string) => void;
    onPluginTabSelect: (contentId: string) => void;
    onPluginTabClose: (contentId: string) => void;
    onFeatureTabSelect: (tabId: string, featureId: FeatureId) => void;
    onFeatureTabClose: (tabId: string, featureId: FeatureId) => void;
    onTerminalClose: (termId: string) => void;
    onNewTerminal: (shell?: ShellEntry) => void;
    onOpenFeature?: (feature: string) => void;
    onFeaturePaneOpened?: (feature: SplitFeatureId) => void;
    onPaneGroupClose: (owner: string) => void;
    onTogglePin: (feature: string) => void;
    sessionToolsOpen?: boolean;
    onToggleSessionTools?: () => void;
    dockPointer?: DockTabPointerHandlers;
}

/**
 * Isolates shell-tab and shell-picker store subscriptions so TabContent
 * does not re-render on every activeTerminalId or shellsLoading change.
 */
export const WorkspaceTabBar = memo(function WorkspaceTabBar({
    connectionId,
    tabId,
    activeView,
    featureTabs,
    activeFeatureTabId,
    pinnedFeatures,
    pluginPanels,
    contentActions,
    onTabSelect,
    onPluginTabSelect,
    onPluginTabClose,
    onFeatureTabSelect,
    onFeatureTabClose,
    onTerminalClose,
    onNewTerminal,
    onOpenFeature,
    onFeaturePaneOpened,
    onPaneGroupClose,
    onTogglePin,
    sessionToolsOpen,
    onToggleSessionTools,
    dockPointer,
}: WorkspaceTabBarProps) {
    const activeTerminalId = useAppStore(
        state => state.activeTerminalIds[connectionId] ?? null,
    );
    const canvasSelection = {
        featureInstanceId: isSplitFeatureId(activeView) ? featureTabs.find(item => item.id === activeFeatureTabId)?.instanceId : undefined,
        pluginPanelId: activeView.startsWith('plugin:') ? activeView.slice('plugin:'.length) : undefined,
        featureId: isSplitFeatureId(activeView) ? activeView : undefined,
    };
    const selectSplitControls = useMemo(() => createWorkspaceSplitControlsSelector(connectionId, canvasSelection),
        [connectionId, canvasSelection.featureInstanceId, canvasSelection.pluginPanelId, canvasSelection.featureId]);
    const { isSplit, canSplit: canSplitPanes } = useAppStore(selectSplitControls);
    const splitPanes = useAppStore(state => state.splitPanes);
    const activatePaneGroup = useAppStore(state => state.activatePaneGroup);
    const releasePaneFromSplit = useAppStore(state => state.releasePaneFromSplit);
    const openFeatureInSplit = useAppStore(state => state.openFeatureInSplit);
    const dockInSplit = useAppStore(state => state.dockInSplit);
    const setTabView = useAppStore(state => state.setTabView);
    const showToast = useAppStore(state => state.showToast);

    const reportDockResult = (result: string) => {
        if (result === 'refused-cap') {
            showToast('info', 'There is no room for another pane. Move a docked pane back to the workspace or close a pane first.');
        }
    };

    const showSplitCanvas = () => {
        if (!useAppStore.getState().workspaceDockFocus?.[connectionId]) setTabView(tabId, 'terminal');
    };

    const handleOpenSplitFeature = (featureId: SplitFeatureId, edge: DockEdge = 'right') => {
        const activeFeatureTab = featureTabs.find(item => (
            item.id === activeFeatureTabId && item.featureId === featureId
        ));
        if (activeView === featureId && activeFeatureTab) {
            const groups = useAppStore.getState().paneLayouts[connectionId];
            const matches = Object.values(groups ?? {}).flatMap(layout => collectLeaves(layout.root)).filter(pane =>
                isFeatureContent(pane.content) && pane.content.featureId === featureId
                && pane.content.instanceId === activeFeatureTab.instanceId);
            if (matches.length !== 1) return;
            const source = matches[0];
            const result = dockInSplit(
                connectionId,
                paneDockPayload(source),
                edge,
                { contentId: paneContentKey(source.content, source.id) },
            );
            reportDockResult(result);
            if (result === 'refused-cap' || result === 'no-target') return;
            onFeaturePaneOpened?.(featureId);
            showSplitCanvas();
            return;
        }
        const result = openFeatureInSplit(connectionId, featureId, edge);
        if (result !== 'refused-cap' && result !== 'no-target') {
            onFeaturePaneOpened?.(featureId);
        }
        reportDockResult(result);
        if (result !== 'refused-cap' && result !== 'no-target') {
            showSplitCanvas();
        }
    };

    const handleDockTerm = (termId: string, edge: DockEdge) => {
        const result = dockInSplit(connectionId, { kind: 'term', termId }, edge);
        reportDockResult(result);
        if (result !== 'refused-cap' && result !== 'no-target') {
            showSplitCanvas();
        }
    };

    const handleOpenSplitPlugin = (pluginId: string, edge: DockEdge = 'right', contentId?: string) => {
        const state = useAppStore.getState();
        const groups = state.paneLayouts[connectionId];
        const source = contentId ? findWorkspaceContentPane(groups, contentId)?.pane : undefined;
        if (contentId && (!source || !isPluginContent(source.content) || source.content.pluginId !== pluginId)) return;
        const existing = source ?? (() => {
            const layout = layoutForPlugin(groups, pluginId, state.activePaneGroupOwner[connectionId]);
            if (!layout) return undefined;
            const focused = findNode(layout.root, layout.activePaneId);
            return focused && isPaneLeaf(focused) && isPluginContent(focused.content) && focused.content.pluginId === pluginId
                ? focused : collectLeaves(layout.root).find(leaf => isPluginContent(leaf.content) && leaf.content.pluginId === pluginId);
        })();
        const result = dockInSplit(
            connectionId,
            existing ? paneDockPayload(existing) : { kind: 'plugin', pluginId },
            edge,
            existing ? { contentId: paneContentKey(existing.content, existing.id) } : overlayPluginPaneId(pluginId),
            undefined,
            existing?.content ?? { kind: 'plugin', pluginId },
        );
        reportDockResult(result);
        if (result === 'refused-cap' || result === 'no-target') return;
        showSplitCanvas();
    };

    const handleSplitNewShell = (edge: DockEdge, shell?: ShellEntry) => {
        const state = useAppStore.getState();
        const target = workspaceSplitTarget(state, connectionId, canvasSelection);
        const addressed = target && { contentId: paneContentKey(target.leaf.content, target.leaf.id) };
        if (!addressed || !allowsAdditionalPaneBeside(state, connectionId, addressed)) {
            reportDockResult(addressed ? 'refused-cap' : 'no-target');
            return;
        }
        const { direction, insert } = splitFromDockEdge(edge);
        if (splitPanes(connectionId, direction, insert, addressed,
            shell ? { shellOverride: shell.id, title: shell.label } : undefined) && activeView !== 'terminal') {
            showSplitCanvas();
        }
    };

    const handleUnsplit = (paneId?: string, owner?: string) => {
        const state = useAppStore.getState();
        const groups = state.paneLayouts[connectionId];
        const dockId = !owner && !paneId ? state.workspaceDockFocus?.[connectionId] : undefined;
        const docked = dockId ? findWorkspaceContentPane(groups, dockId) : undefined;
        if (dockId && !docked) return;
        const layout = owner ? groups?.[owner] : docked ? groups?.[docked.owner] : layoutForCanvas(
                groups,
                state.activeTerminalIds[connectionId],
                state.activePaneGroupOwner[connectionId],
            );
        const visible = layout && projectVisiblePaneLayout(layout, hiddenWorkspaceContent(state, connectionId));
        const focused = visible ? findNode(visible.root, paneId ?? docked?.pane.id ?? visible.activePaneId) : null;
        if (!focused || !isPaneLeaf(focused)) return;
        const released = focused.content;

        if (!releasePaneFromSplit(connectionId, { contentId: paneContentKey(focused.content, focused.id) })) return;

        if (isFeatureContent(released)) {
            onFeaturePaneOpened?.(released.featureId);
            const featureTab = featureTabs.find(item => (
                item.featureId === released.featureId
                && item.instanceId === released.instanceId
            ));
            if (featureTab) {
                onFeatureTabSelect(featureTab.id, featureTab.featureId);
            } else {
                onTabSelect(released.featureId);
            }
        } else if (isPluginContent(released)) {
            onPluginTabSelect(paneContentKey(released, focused.id));
        } else {
            onTabSelect('terminal', released.termId);
        }
    };
    const hostIsWindows = connectionId === LOCAL_TERMINAL_CONNECTION_ID
        && window.electronUtils?.platform === 'win32';
    const remoteReady = useAppStore(state => state.connections.some(
        connection => connection.id === connectionId && connection.status === 'connected',
    ));
    const {
        shells: availableShells,
        isLoading: shellsLoading,
        error: shellsError,
        refetch: refetchShells,
    } = useAvailableShells({ isWindows: hostIsWindows, connectionId, remoteReady });

    return (
        <CombinedTabBar
            connectionId={connectionId}
            tabId={tabId}
            activeView={activeView}
            activeTerminalId={activeTerminalId}
            featureTabs={featureTabs}
            activeFeatureTabId={activeFeatureTabId}
            pinnedFeatures={pinnedFeatures}
            pluginPanels={pluginPanels}
            contentActions={contentActions}
            availableShells={availableShells}
            shellsLoading={shellsLoading}
            shellsError={shellsError}
            onRefetchShells={refetchShells}
            onTabSelect={onTabSelect}
            onPluginTabSelect={onPluginTabSelect}
            onPluginTabClose={onPluginTabClose}
            onFeatureTabSelect={onFeatureTabSelect}
            onFeatureTabClose={onFeatureTabClose}
            onTerminalClose={onTerminalClose}
            onNewTerminal={onNewTerminal}
            onOpenFeature={onOpenFeature}
            onTogglePin={onTogglePin}
            sessionToolsOpen={sessionToolsOpen}
            onToggleSessionTools={onToggleSessionTools}
            isSplit={isSplit}
            canSplit={canSplitPanes}
            onSplit={(direction) => {
                // Use the same fresh visible target as availability and keyboard
                // splitting; center selection is independent from dock focus.
                const target = workspaceSplitTarget(useAppStore.getState(), connectionId, canvasSelection);
                if (!target) return;
                if (splitPanes(connectionId, direction, 'after', { contentId: paneContentKey(target.leaf.content, target.leaf.id) })) {
                    showSplitCanvas();
                }
            }}
            onUnsplit={() => handleUnsplit()}
            onSplitSelect={(owner) => {
                activatePaneGroup(connectionId, owner);
                showSplitCanvas();
            }}
            onPaneGroupClose={onPaneGroupClose}
            onSplitUnsplit={(owner, paneId) => handleUnsplit(paneId, owner)}
            onOpenSplitFeature={handleOpenSplitFeature}
            onOpenSplitPlugin={handleOpenSplitPlugin}
            onDockTerm={handleDockTerm}
            onSplitNewShell={handleSplitNewShell}
            dockPointer={dockPointer}
        />
    );
});
