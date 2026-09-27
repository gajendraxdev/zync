import { useMemo, type PointerEvent, type ReactNode } from 'react';
import { FolderOpen, Plug, Terminal as TerminalIcon, X, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
    isFeatureContent,
    isPluginContent,
    isTermContent,
    paneDockPayload,
    type PaneLeaf,
    type PaneLayout,
    type SplitFeatureId,
} from '../../lib/paneLayout';
import type { TerminalTab } from '../../store/terminalSlice';
import { FEATURE_META } from '../layout/featureMeta';
import { useAppStore } from '../../store/useAppStore';
import { TerminalComponent } from './Terminal';
import { FeaturePaneBody } from './FeaturePaneBody';
import { useDockTabPointer, type DockTabPointerHandlers } from '../layout/tabDock';
import { usePlugins } from '../../context/PluginContext';
import { PluginIcon } from '../icons/PluginIcon';
import type { InternalEdges } from '../workspace/paneSurfaces';

const EMPTY_TERMINAL_TABS: TerminalTab[] = [];

function FocusEdges({ edges }: { edges: InternalEdges }) {
    const line = 'pointer-events-none absolute z-10 bg-app-accent/60';
    return (
        <>
            {edges.top && <div aria-hidden className={cn(line, 'inset-x-0 top-0 h-px')} />}
            {edges.right && <div aria-hidden className={cn(line, 'inset-y-0 right-0 w-px')} />}
            {edges.bottom && <div aria-hidden className={cn(line, 'inset-x-0 bottom-0 h-px')} />}
            {edges.left && <div aria-hidden className={cn(line, 'inset-y-0 left-0 w-px')} />}
        </>
    );
}

function PaneHeader({
    label,
    Icon,
    icon,
    focused,
    onPointerDown,
    onClose,
}: {
    label: string;
    Icon: LucideIcon;
    icon?: ReactNode;
    focused: boolean;
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
    onClose: () => void;
}) {
    return (
        <div
            className="h-7 shrink-0 flex items-center gap-1.5 px-2 border-b border-app-border/60 bg-app-panel cursor-grab active:cursor-grabbing select-none"
            onPointerDown={onPointerDown}
        >
            {icon ?? <Icon size={12} className={cn(focused ? 'text-app-accent' : 'text-app-muted')} />}
            <span className="flex-1 truncate text-[11px] font-medium text-app-text">{label}</span>
            <button
                type="button"
                onPointerDown={(event) => {
                    event.stopPropagation();
                }}
                onClick={(event) => {
                    event.stopPropagation();
                    onClose();
                }}
                className="h-5 w-5 inline-flex items-center justify-center rounded text-app-muted hover:bg-app-bg hover:text-red-400"
                aria-label={`Close ${label} pane`}
                title={`Close ${label}`}
            >
                <X size={12} />
            </button>
        </div>
    );
}

function FeaturePaneLeaf({
    connectionId,
    paneId,
    featureId,
    pluginId,
    pluginLabel,
    instanceId,
    focused,
    showFocus,
    showHeader,
    panelVisible,
    edges,
    onFocus,
    onClose,
    onHeaderPointerDown,
}: {
    connectionId: string;
    paneId: string;
    featureId?: SplitFeatureId;
    pluginId?: string;
    pluginLabel?: string;
    instanceId?: string;
    focused: boolean;
    showFocus: boolean;
    showHeader: boolean;
    panelVisible: boolean;
    edges: InternalEdges;
    onFocus: () => void;
    onClose: () => void;
    onHeaderPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
    const meta = featureId ? FEATURE_META[featureId] : undefined;
    const Icon = meta?.icon ?? (pluginId ? Plug : FolderOpen);
    const label = meta?.label ?? pluginLabel ?? pluginId ?? featureId ?? 'Panel';

    return (
        <div
            data-pane-id={paneId}
            data-files-instance-id={featureId === 'files' ? instanceId : undefined}
            className="relative h-full w-full min-h-0 min-w-0 overflow-hidden flex flex-col bg-app-bg"
            onMouseDown={onFocus}
            onFocusCapture={onFocus}
            onWheelCapture={() => {
                if (!focused) onFocus();
            }}
        >
            {showHeader && (
                <PaneHeader
                    label={label}
                    Icon={Icon}
                    icon={pluginId ? <PluginIcon panelId={pluginId} size={14} /> : undefined}
                    focused={focused}
                    onPointerDown={onHeaderPointerDown}
                    onClose={onClose}
                />
            )}
            <div className="relative flex-1 min-h-0 min-w-0">
                <FeaturePaneBody
                    connectionId={connectionId}
                    featureId={featureId}
                    pluginId={pluginId}
                    instanceId={instanceId}
                    visible={panelVisible}
                />
            </div>
            {showFocus && <FocusEdges edges={edges} />}
        </div>
    );
}

export function PaneLeafView({
    connectionId, node, layout, split, edges, workspaceActive, panelVisible, dockPointer,
}: {
    connectionId: string;
    node: PaneLeaf;
    layout: PaneLayout;
    split: boolean;
    edges: InternalEdges;
    workspaceActive: boolean;
    panelVisible: boolean;
    dockPointer?: DockTabPointerHandlers;
}) {
    const focusPane = useAppStore(state => state.focusPane);
    const closePaneInSplit = useAppStore(state => state.closePaneInSplit);
    const terminalTabs = useAppStore(state => state.terminals[connectionId] || EMPTY_TERMINAL_TABS);
    const { panels: pluginPanels } = usePlugins();
    const { begin: beginDockPointer } = useDockTabPointer(dockPointer);
    const terminalTitles = useMemo(() => new Map(terminalTabs.map(tab => [tab.id, tab.title])), [terminalTabs]);
    const pluginTitles = useMemo(() => new Map(pluginPanels.map(panel => [panel.id, panel.title])), [pluginPanels]);

    const focused = layout.activePaneId === node.id;
    const showFocus = focused && workspaceActive && panelVisible;
    if (isFeatureContent(node.content) || isPluginContent(node.content)) {
        const content = node.content;
        const featureId = isFeatureContent(content) ? content.featureId : undefined;
        const contentInstanceId = isFeatureContent(content) || isPluginContent(content)
            ? content.instanceId
            : undefined;
        const pluginId = isPluginContent(content) ? content.pluginId : undefined;
        const dockPayload = paneDockPayload(node);
        return (
            <FeaturePaneLeaf
                connectionId={connectionId}
                paneId={node.id}
                featureId={featureId}
                instanceId={contentInstanceId}
                pluginId={pluginId}
                pluginLabel={pluginId ? pluginTitles.get(pluginId) : undefined}
                focused={focused}
                showFocus={showFocus}
                showHeader={split}
                panelVisible={panelVisible}
                edges={edges}
                onFocus={() => focusPane(connectionId, node.id)}
                onClose={() => closePaneInSplit(connectionId, node.id)}
                onHeaderPointerDown={(event) => beginDockPointer(event, dockPayload)}
            />
        );
    }
    if (!isTermContent(node.content)) return null;
    const termId = node.content.termId;
    return (
        <div
            data-pane-id={node.id}
            className={cn('relative h-full w-full min-h-0 min-w-0 overflow-hidden flex flex-col', split && 'bg-app-bg')}
            onMouseDown={(event) => {
                focusPane(connectionId, node.id);
                if (!(event.target instanceof Element) || !event.target.closest('.xterm')) {
                    const helper = event.currentTarget.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
                    helper?.focus();
                }
            }}
            onWheelCapture={() => {
                if (!focused) focusPane(connectionId, node.id);
            }}
        >
            {split && (
                <PaneHeader
                    label={terminalTitles.get(termId) ?? 'Shell'}
                    Icon={TerminalIcon}
                    focused={focused}
                    onPointerDown={(event) => beginDockPointer(event, paneDockPayload(node))}
                    onClose={() => closePaneInSplit(connectionId, node.id)}
                />
            )}
            <div className="flex-1 min-h-0 min-w-0">
                <TerminalComponent
                    connectionId={connectionId}
                    termId={termId}
                    isWorkspaceActive={workspaceActive}
                    isTerminalView
                    isActiveTab={panelVisible}
                    isFocused={focused}
                    isVisible={panelVisible}
                />
            </div>
            {showFocus && <FocusEdges edges={edges} />}
        </div>
    );
}
