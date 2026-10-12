import { Blocks, ChevronDown, ChevronRight, CircleUserRound, FileText, Folder, LayoutGrid, Link, Maximize2, Plus, Search, Server, Settings, Shield, SquareTerminal, Unplug, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { ELEMENT_COLOR_DEFINITIONS, normalizeElementColor, type ElementColorArea, type ElementColorKey } from '../domain/elementColors';
import { ELEMENT_COLOR_BINDINGS } from './elementColorBindings';

export interface ElementColorPreviewProps {
    area: ElementColorArea;
    /** Effective drafts/saved/theme references. No live resource or action props. */
    colors: Readonly<Partial<Record<ElementColorKey, string | null>>>;
}

/** A static miniature workspace, not a second workspace implementation.
 * Theme fallbacks come from the production color bindings. No store, DOM sampling,
 * terminal renderer, plugins or focusable imitation controls are mounted here.
 */
export function ElementColorPreview({ area, colors }: ElementColorPreviewProps) {
    const color = (key: ElementColorKey) => normalizeElementColor(colors[key]) ?? `var(${ELEMENT_COLOR_BINDINGS[key].fallback})`;
    const surface = (name: Exclude<ElementColorArea, 'terminal'>): CSSProperties => ({
        backgroundColor: color(`${name}.background`), color: color(`${name}.foreground`), borderColor: color(`${name}.border`),
    });
    const activeTab = (name: 'mainTabs' | 'contentTabs'): CSSProperties => ({
        backgroundColor: color(`${name}.activeBackground`), color: color(`${name}.activeForeground`),
    });
    const files = area === 'panel' || area === 'control';
    const split = area === 'paneHeader';
    const areaLabel = ELEMENT_COLOR_DEFINITIONS.find(entry => entry.area === area)!.areaLabel;
    return <figure data-zync-color-protected className="min-w-0 space-y-2">
        <figcaption className="flex flex-wrap items-center justify-between gap-1 text-xs">
            <span className="font-medium">Preview · {areaLabel}</span><span className="text-app-muted">Sample workspace</span>
        </figcaption>
        <div role="img" aria-label={`Area preview: ${areaLabel} in a sample workspace. Visual only; no sessions or actions.`}
            className="min-w-0 overflow-hidden rounded-md border border-app-border bg-app-bg text-[11px] leading-relaxed select-none">
            <div aria-hidden="true">
                <div data-preview-area="mainTabs" className="flex h-9 min-w-0 items-center gap-1 border-b px-1.5" style={surface('mainTabs')}>
                    <span className="flex min-w-0 items-center gap-1.5 rounded px-2 py-1"><SquareTerminal size={12} className="shrink-0" /><span className="truncate">Local</span></span>
                    <span data-preview-active="mainTabs" className="flex min-w-0 items-center gap-1.5 rounded px-2 py-1" style={activeTab('mainTabs')}>
                        <Server size={12} className="shrink-0" /><span className="truncate font-medium">demo-server</span><X size={11} className="shrink-0" />
                    </span><Plus size={13} className="ml-1 shrink-0" />
                </div>
                <div className="flex min-h-48 min-w-0">
                    <div data-preview-area="navigation" className="flex w-9 shrink-0 flex-col items-center gap-2 border-r py-2" style={surface('navigation')}>
                        <span className="rounded p-1.5 bg-app-surface"><Server size={14} /></span><Shield size={14} />
                        <span data-preview-hover="navigation" className="rounded p-1.5" style={{ backgroundColor: color('navigation.hoverBackground') }}><Link size={14} /></span>
                        <Blocks size={14} /><Settings size={14} className="mt-auto" /><CircleUserRound size={14} />
                    </div>
                    <div data-preview-area="sidebar" className="w-[28%] min-w-0 max-w-36 shrink-0 border-r px-2 py-2" style={surface('sidebar')}>
                        <div className="mb-3 flex items-center gap-1 text-[9px] font-semibold tracking-wide"><Server size={11} className="shrink-0" /><span className="truncate">ALL HOSTS</span><ChevronDown size={10} className="ml-auto shrink-0" /></div>
                        <div className="mb-2 flex items-center gap-1 opacity-70"><Search size={11} className="shrink-0" /><span className="truncate">Search hosts</span></div>
                        <div className="mb-1 flex min-w-0 items-center gap-1.5 rounded bg-app-surface/65 px-1 py-1.5"><Server size={12} className="shrink-0" /><span className="truncate font-medium">demo-server</span></div>
                        <div className="flex min-w-0 items-center gap-1.5 px-1 py-1.5"><SquareTerminal size={12} className="shrink-0" /><span className="truncate">Local terminal</span></div>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col">
                        <div data-preview-area="contentTabs" className="flex h-8 min-w-0 items-center gap-1 border-b px-1" style={surface('contentTabs')}>
                            <span data-preview-active="contentTabs" className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5" style={activeTab('contentTabs')}>
                                {files ? <Folder size={12} className="shrink-0" /> : <SquareTerminal size={12} className="shrink-0" />}
                                <span className="truncate font-medium">{files ? 'Files' : 'Shell 1'}</span>
                                {split && <span className="shrink-0 rounded bg-current/10 px-1 text-[9px]">2 panes</span>}
                            </span>
                            <span className="flex min-w-0 items-center gap-1 px-1.5"><span className="truncate">{split ? 'Shell 2' : files ? 'Shell 1' : 'Files'}</span></span>
                            <Plus size={12} className="ml-auto shrink-0" />
                        </div>
                        <div className="flex min-w-0 flex-1">
                            <div className="flex min-w-0 flex-1 flex-col">
                                {split && <PreviewPaneHeader label="Shell 1" style={surface('paneHeader')} />}
                                {files ? <PreviewFiles panel={surface('panel')} control={surface('control')} />
                                    : <div data-preview-area="terminal" className="min-w-0 flex-1 overflow-hidden p-3 font-mono text-[10px] leading-5"
                                        style={{ backgroundColor: color('terminal.background'), color: color('terminal.foreground') }}>
                                        <p className="truncate opacity-70">~/project</p><p className="truncate">$ ls</p>
                                        <p className="truncate"><span data-preview-selection style={{ backgroundColor: normalizeElementColor(colors['terminal.selectionBackground']) ?? 'color-mix(in srgb, var(--color-app-accent) 20%, transparent)' }}>src/</span> docs/</p>
                                        <p className="truncate">$ <span data-preview-cursor className="inline-block h-3 w-1.5 align-middle" style={{ backgroundColor: color('terminal.cursor') }} /></p>
                                    </div>}
                            </div>
                            {split && <div className="flex w-2/5 min-w-0 flex-col border-l border-app-border">
                                <PreviewPaneHeader label="Files" style={surface('paneHeader')} />
                                <PreviewFiles panel={surface('panel')} control={surface('control')} compact />
                            </div>}
                        </div>
                    </div>
                </div>
                <div data-preview-area="statusBar" className="flex min-w-0 items-center gap-2 border-t px-2 py-1" style={surface('statusBar')}>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-app-success" /><span className="truncate">SSH · demo-server</span>
                    <Unplug size={11} className="shrink-0" /><span className="ml-auto shrink-0">{files ? '3 items' : 'UTF-8'}</span>
                </div>
            </div>
        </div>
    </figure>;
}

function PreviewPaneHeader({ label, style }: { label: string; style: CSSProperties }) {
    return <div data-preview-area="paneHeader" className="flex h-7 min-w-0 shrink-0 items-center gap-1 border-b px-1.5" style={style}>
        <LayoutGrid size={11} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{label}</span>
        <Maximize2 size={10} className="shrink-0" /><X size={10} className="shrink-0" />
    </div>;
}

function PreviewFiles({ panel, control, compact = false }: { panel: CSSProperties; control: CSSProperties; compact?: boolean }) {
    return <div data-preview-area="panel" className="min-w-0 flex-1 border p-2" style={panel}>
        {!compact && <div data-preview-area="control" className="mb-2 flex min-w-0 items-center gap-1 rounded border px-1.5 py-1" style={control}>
            <Folder size={11} className="shrink-0" /><span className="truncate">/home/demo/project</span><ChevronRight size={11} className="ml-auto shrink-0" />
        </div>}
        <div className="mb-1 border-b pb-1 text-[9px] opacity-70" style={{ borderColor: panel.borderColor }}>Name</div>
        {['src', 'docs', 'README.md'].map(name => <div key={name} className="flex min-w-0 items-center gap-1.5 py-1">
            {name.endsWith('.md') ? <FileText size={11} className="shrink-0" /> : <Folder size={11} className="shrink-0" />}<span className="truncate">{name}</span>
        </div>)}
        {!compact && <span data-preview-area="control" className="mt-2 inline-flex items-center gap-1 rounded border px-1.5 py-0.5" style={control}><Plus size={11} />New folder</span>}
    </div>;
}
