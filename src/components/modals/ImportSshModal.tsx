import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Select } from '../ui/Select';
import { useAppStore } from '../../store/useAppStore';
import { CheckCircle2, AlertCircle, Loader2, FolderOpen, Search, X, ArrowRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { OSIcon } from '../icons/OSIcon';
import { registerModal } from '../../lib/modalRegistry';
import { importSshConfigIpc, internalizeImportedConnectionsIpc, type ImportedConnectionPayload } from '../../features/connections/infrastructure/connectionIpc';
import { applyImportPlan, buildImportPlanRows, type AppliedImportPlan, type ImportResolution } from '../../features/connections/domain';

type ImportReport = {
    selected: number;
    created: number;
    updated: number;
    skipped: number;
    conflicted: number;
    renamed: Array<{ id: string; from: string; to: string }>;
};

interface ImportSshModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImport: (items: AppliedImportPlan['toImport']) => void;
    onImportReport?: (report: ImportReport) => void;
}

interface ImportSummaryBarProps {
    totalCount: number;
    selectedCount: number;
    createdCount: number;
    updatedCount: number;
    skippedCount: number;
    conflictCount: number;
    allVisibleSelected: boolean;
    isSearchOpen: boolean;
    searchQuery: string;
    onSearchOpen: () => void;
    onSearchClose: () => void;
    onSearchChange: (value: string) => void;
    onToggleAll: () => void;
    bulkConflictDecision: ImportResolution;
    onBulkConflictDecisionChange: (decision: ImportResolution) => void;
    onApplyConflictDecision: (decision: ImportResolution) => void;
}

const RESOLUTION_OPTIONS: Array<{ value: ImportResolution; label: string }> = [
    { value: 'new', label: 'Import as New' },
    { value: 'update', label: 'Update Existing' },
    { value: 'skip', label: 'Skip' },
];

const BULK_CONFLICT_OPTIONS: Array<{ value: ImportResolution; label: string }> = [
    { value: 'new', label: 'New' },
    { value: 'update', label: 'Update' },
    { value: 'skip', label: 'Skip' },
];

const IMPORT_TABLE_GRID_CLASS = 'grid-cols-[34px_90px_minmax(0,1.2fr)_minmax(0,1fr)_136px]';
const IMPORT_ACTION_SELECT_CLASS = 'w-[124px] justify-self-end';
const IMPORT_ACTION_TRIGGER_CLASS = 'h-8 rounded-md border border-app-border bg-app-bg px-2 text-xs shadow-none';

const createDefaultDecisionMap = (
    existingConnections: ImportedConnectionPayload[],
    importedConfigs: ImportedConnectionPayload[],
): Record<string, ImportResolution> => {
    const rows = buildImportPlanRows(existingConnections, importedConfigs);
    const defaults: Record<string, ImportResolution> = {};
    for (const row of rows) {
        defaults[row.imported.id] = row.recommended;
    }
    return defaults;
};

function ImportSummaryBar({
    totalCount,
    selectedCount,
    createdCount,
    updatedCount,
    skippedCount,
    conflictCount,
    allVisibleSelected,
    isSearchOpen,
    searchQuery,
    onSearchOpen,
    onSearchClose,
    onSearchChange,
    onToggleAll,
    bulkConflictDecision,
    onBulkConflictDecisionChange,
    onApplyConflictDecision,
}: ImportSummaryBarProps) {
    return (
        <div className="px-5 py-2.5 border-b border-app-border bg-app-bg/50">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-medium text-app-muted">
                    <span className="uppercase tracking-wider">Found {totalCount} connections</span>
                    <span className="rounded-full border border-app-border bg-app-surface px-2 py-0.5 text-[11px] normal-case text-app-text">
                        Selected {selectedCount}
                    </span>
                    <button
                        onClick={onToggleAll}
                        className="text-xs text-app-accent hover:underline font-medium whitespace-nowrap"
                    >
                        {allVisibleSelected ? 'Deselect All' : 'Select All'}
                    </button>
                </div>
                <div className="flex items-center gap-2">
                    {isSearchOpen || searchQuery ? (
                        <div className="relative w-52">
                            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-app-muted/70" />
                            <input
                                autoFocus
                                value={searchQuery}
                                onChange={(event) => onSearchChange(event.target.value)}
                                onBlur={() => {
                                    if (!searchQuery.trim()) onSearchClose();
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                        event.preventDefault();
                                        onSearchClose();
                                    }
                                }}
                                placeholder="Search name, host, user"
                                className="h-7 w-full rounded-md border border-app-border bg-app-bg pl-7 pr-7 text-xs text-app-text outline-none focus:border-app-accent/60"
                            />
                            <button
                                type="button"
                                onClick={onSearchClose}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-app-muted hover:text-app-text"
                                aria-label="Close search"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    ) : (
                        <button
                            type="button"
                            onClick={onSearchOpen}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-app-border bg-app-bg text-app-muted transition-colors"
                            aria-label="Search imported connections"
                        >
                            <Search className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
            <div className="mt-2 flex items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-md border border-app-border bg-app-surface/70 px-2 py-1 text-app-muted">
                        New {createdCount}
                    </span>
                    <span className="rounded-md border border-app-border bg-app-surface/70 px-2 py-1 text-app-text font-medium">
                        Update {updatedCount}
                    </span>
                    <span className="rounded-md border border-app-border bg-app-surface/70 px-2 py-1 text-app-muted">
                        Skip {skippedCount}
                    </span>
                </div>
                {conflictCount > 0 && (
                    <div className="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface/70 px-1.5 py-1 text-xs">
                        <span className="text-app-muted">Conflicts {conflictCount}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-app-muted/80" />
                        <Select
                            value={bulkConflictDecision}
                            onChange={(value) => {
                                const nextDecision = value as ImportResolution;
                                onBulkConflictDecisionChange(nextDecision);
                                onApplyConflictDecision(nextDecision);
                            }}
                            options={BULK_CONFLICT_OPTIONS}
                            showSearch={false}
                            showCheck={false}
                            portal
                            className="w-[96px]"
                            triggerClassName="h-6 rounded border border-app-border bg-app-bg px-1.5 text-xs shadow-none"
                        />
                    </div>
                )}
            </div>
        </div>
    );
}

export function ImportSshModal({ isOpen, onClose, onImport, onImportReport }: ImportSshModalProps) {
    const existingConnections = useAppStore(state => state.connections);
    const [configs, setConfigs] = useState<ImportedConnectionPayload[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [decisions, setDecisions] = useState<Record<string, ImportResolution>>({});
    const [searchQuery, setSearchQuery] = useState('');
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [importReport, setImportReport] = useState<ImportReport | null>(null);
    const [bulkConflictDecision, setBulkConflictDecision] = useState<ImportResolution>('update');

    useEffect(() => {
        if (isOpen) {
            loadConfigs();
        } else {
            setConfigs([]);
            setSelectedIds(new Set());
            setDecisions({});
            setSearchQuery('');
            setIsSearchOpen(false);
            setError(null);
            setImportReport(null);
            setBulkConflictDecision('update');
        }
    }, [isOpen]);

    const loadConfigs = async () => {
        setIsLoading(true);
        setError(null);
        try {
            const result = await importSshConfigIpc();
            if (Array.isArray(result)) {
                setConfigs(result);
                setSelectedIds(new Set(result.map(c => c.id)));
                setDecisions(createDefaultDecisionMap(existingConnections, result));
            } else {
                setConfigs([]);
            }
        } catch (err: any) {
            console.error('Failed to import SSH config', err);
            setError(err.message || 'Failed to read SSH config file');
        } finally {
            setIsLoading(false);
        }
    };

    const toggleSelection = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedIds(newSet);
    };

    const rows = useMemo(
        () => buildImportPlanRows(existingConnections, configs),
        [configs, existingConnections]
    );

    const filteredRows = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((row) => {
            const config = row.imported;
            return (
                (config.name || '').toLowerCase().includes(q) ||
                (config.host || '').toLowerCase().includes(q) ||
                (config.username || '').toLowerCase().includes(q)
            );
        });
    }, [rows, searchQuery]);

    const filteredRowIds = useMemo(
        () => filteredRows.map((row) => row.imported.id),
        [filteredRows]
    );

    const visibleCount = filteredRowIds.length;
    const selectedCount = selectedIds.size;
    const hasConfigs = configs.length > 0;
    const allVisibleSelected = visibleCount > 0 && filteredRowIds.every((id) => selectedIds.has(id));

    const selectedRows = rows.filter((row) => selectedIds.has(row.imported.id));
    const conflictRows = selectedRows.filter((row) => row.matchedByName || row.matchedByEndpoint);
    const planSummary = useMemo(
        () => applyImportPlan(existingConnections, selectedRows, decisions),
        [decisions, existingConnections, selectedRows]
    );

    const toggleAll = () => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (allVisibleSelected) {
                filteredRowIds.forEach((id) => next.delete(id));
            } else {
                filteredRowIds.forEach((id) => next.add(id));
            }
            return next;
        });
    };

    const updateDecision = (id: string, next: ImportResolution) => {
        setDecisions((prev) => ({ ...prev, [id]: next }));
    };

    const applyConflictDecision = (nextDecision: ImportResolution) => {
        setDecisions((prev) => {
            const next = { ...prev };
            for (const row of conflictRows) {
                next[row.imported.id] = nextDecision;
            }
            return next;
        });
    };

    const buildReport = (): ImportReport => ({
        selected: selectedIds.size,
        created: planSummary.created,
        updated: planSummary.updated,
        skipped: planSummary.skipped,
        conflicted: conflictRows.length,
        renamed: planSummary.renamed,
    });

    const handleImport = async () => {
        setIsLoading(true);
        try {
            const selectedPlanItems = planSummary.toImport;
            if (selectedPlanItems.length === 0) {
                const nextReport = buildReport();
                setImportReport(nextReport);
                onImportReport?.(nextReport);
                return;
            }
            const selectedConnections = selectedPlanItems.map((item) => item.connection);
            const internalizeResult = await internalizeImportedConnectionsIpc(selectedConnections);

            if (Array.isArray(internalizeResult)) {
                const internalizedById = new Map(
                    internalizeResult
                        .filter((connection) => connection?.id)
                        .map((connection) => [connection.id, connection] as const)
                );
                const internalizedCount = internalizeResult.filter((c, i) =>
                    c.privateKeyPath && c.privateKeyPath !== selectedConnections[i]?.privateKeyPath
                ).length;
                console.log(`[Import] Internalized keys for ${internalizedCount} connections.`);
                const mergedPlanItems = selectedPlanItems.map((item, index) => {
                    const byId = internalizedById.get(item.connection.id);
                    const byIndex = internalizeResult[index];
                    return {
                        ...item,
                        connection: byId || byIndex || item.connection,
                    };
                });
                onImport(mergedPlanItems);
            } else {
                onImport(selectedPlanItems);
            }

            const nextReport = buildReport();
            setImportReport(nextReport);
            onImportReport?.(nextReport);
        } catch (importError) {
            console.error('Failed to internalize keys:', importError);
            const plannedFallback = planSummary.toImport;
            let fallbackItems = plannedFallback;
            if (plannedFallback.length === 0) {
                fallbackItems = configs
                    .filter((c) => selectedIds.has(c.id))
                    .map((connection) => ({ connection, targetId: null, matchType: null }));
            }
            onImport(fallbackItems);
            const nextReport = buildReport();
            setImportReport(nextReport);
            onImportReport?.(nextReport);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Import SSH Connections"
            subtitle="Select the connections you want to import from your local SSH config file. Choose per-item strategy for duplicates (new/update/skip)."
            className="w-full max-w-2xl"
            contentClassName="flex flex-col p-0 overflow-hidden"
        >
            <div className="flex h-full min-h-0 flex-col">
                {!isLoading && !error && hasConfigs && (
                    <ImportSummaryBar
                        totalCount={configs.length}
                        selectedCount={selectedCount}
                        createdCount={planSummary.created}
                        updatedCount={planSummary.updated}
                        skippedCount={planSummary.skipped}
                        conflictCount={conflictRows.length}
                        allVisibleSelected={allVisibleSelected}
                        isSearchOpen={isSearchOpen}
                        searchQuery={searchQuery}
                        onSearchOpen={() => setIsSearchOpen(true)}
                        onSearchClose={() => {
                            setSearchQuery('');
                            setIsSearchOpen(false);
                        }}
                        onSearchChange={(value) => setSearchQuery(value)}
                        onToggleAll={toggleAll}
                        bulkConflictDecision={bulkConflictDecision}
                        onBulkConflictDecisionChange={setBulkConflictDecision}
                        onApplyConflictDecision={applyConflictDecision}
                    />
                )}

                <div className="min-h-0 flex-1 overflow-y-auto pt-0 pb-3">
                    {importReport ? (
                        <div className="space-y-4 rounded-lg border border-app-border bg-app-surface/30 p-4">
                            <h4 className="text-sm font-semibold text-app-text">Import complete</h4>
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="rounded-md border border-app-border bg-app-bg px-2.5 py-2">
                                    <p className="text-app-muted">Selected</p>
                                    <p className="mt-1 text-app-text font-semibold">{importReport.selected}</p>
                                </div>
                                <div className="rounded-md border border-app-border bg-app-bg px-2.5 py-2">
                                    <p className="text-app-muted">Conflicts handled</p>
                                    <p className="mt-1 text-app-text font-semibold">{importReport.conflicted}</p>
                                </div>
                                <div className="rounded-md border border-app-border bg-app-bg px-2.5 py-2">
                                    <p className="text-app-muted">Created</p>
                                    <p className="mt-1 text-app-text font-semibold">{importReport.created}</p>
                                </div>
                                <div className="rounded-md border border-app-border bg-app-bg px-2.5 py-2">
                                    <p className="text-app-muted">Updated</p>
                                    <p className="mt-1 text-app-text font-semibold">{importReport.updated}</p>
                                </div>
                                <div className="rounded-md border border-app-border bg-app-bg px-2.5 py-2 col-span-2">
                                    <p className="text-app-muted">Skipped</p>
                                    <p className="mt-1 text-app-text font-semibold">{importReport.skipped}</p>
                                </div>
                            </div>

                            {importReport.renamed.length > 0 && (
                                <div className="rounded-md border border-app-border bg-app-bg px-2.5 py-2">
                                    <p className="text-xs font-medium text-app-text">Auto-renamed to avoid conflicts</p>
                                    <ul className="mt-2 space-y-1 text-xs text-app-muted">
                                        {importReport.renamed.slice(0, 8).map((entry) => (
                                            <li key={entry.id} className="truncate">
                                                {entry.from} → {entry.to}
                                            </li>
                                        ))}
                                        {importReport.renamed.length > 8 && (
                                            <li className="text-app-muted">+{importReport.renamed.length - 8} more</li>
                                        )}
                                    </ul>
                                </div>
                            )}
                        </div>
                    ) : isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-app-muted gap-3">
                            <Loader2 className="w-8 h-8 animate-spin text-app-accent" />
                            <p>Scanning SSH config...</p>
                        </div>
                    ) : error ? (
                        <div className="flex flex-col items-center justify-center h-full text-red-500 gap-3 p-4 text-center">
                            <AlertCircle className="w-8 h-8" />
                            <p>{error}</p>
                            <Button variant="secondary" size="sm" onClick={loadConfigs}>Retry</Button>
                        </div>
                    ) : configs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-app-muted gap-3">
                            <FolderOpen className="w-10 h-10 opacity-50" />
                            <p>No SSH configurations found.</p>
                            <p className="text-xs opacity-70">Check ~/.ssh/config</p>
                        </div>
                    ) : (
                        <div>
                            <div className={cn('grid items-center gap-2 border-b border-app-border bg-app-surface/20 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-app-muted', IMPORT_TABLE_GRID_CLASS)}>
                                <span />
                                <span className="border-l border-app-border/70 pl-3">Status</span>
                                <span className="border-l border-app-border/70 pl-3">Connection</span>
                                <span className="border-l border-app-border/70 pl-3">Endpoint</span>
                                <span className="border-l border-app-border/70 pl-3 text-right pr-1">Action</span>
                            </div>
                            {filteredRows.length === 0 && (
                                <div className="px-3 py-8 text-center text-xs text-app-muted">
                                    No matching connections
                                </div>
                            )}
                            {filteredRows.map((row) => {
                                const config = row.imported;
                                const isSelected = selectedIds.has(config.id);
                                const matchedConnection = row.matchedByName || row.matchedByEndpoint;
                                const hasConflict = !!matchedConnection;
                                const statusLabel = hasConflict ? 'Conflict' : 'New';

                                return (
                                    <div
                                        key={config.id}
                                        role="button"
                                        tabIndex={0}
                                        aria-pressed={isSelected}
                                        onClick={() => toggleSelection(config.id)}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                toggleSelection(config.id);
                                            }
                                        }}
                                        className={cn(
                                            `grid ${IMPORT_TABLE_GRID_CLASS} items-center gap-2 border-b border-app-border/60 px-4 py-2 cursor-pointer transition-colors group`,
                                            isSelected
                                                ? "bg-app-accent/6"
                                                : "bg-app-bg hover:bg-app-surface/40"
                                        )}
                                    >
                                        <div
                                            className={cn(
                                                "w-4.5 h-4.5 rounded border flex items-center justify-center transition-colors shrink-0",
                                                isSelected
                                                    ? "bg-app-accent border-app-accent text-white"
                                                    : "bg-app-bg border-app-border text-transparent group-hover:border-app-muted"
                                            )}
                                        >
                                            <CheckCircle2 size={12} className={cn("transition-transform", isSelected ? "scale-100" : "scale-0")} />
                                        </div>

                                        <div className="flex items-center gap-1.5 text-xs">
                                            <span
                                                className={cn(
                                                    'inline-block h-2 w-2 rounded-full',
                                                    hasConflict ? 'bg-amber-400' : 'bg-emerald-400'
                                                )}
                                            />
                                            <span className={cn(hasConflict ? 'text-amber-300' : 'text-emerald-300')}>
                                                {statusLabel}
                                            </span>
                                        </div>

                                        <div className="min-w-0">
                                            <div className={cn("text-[13px] font-medium truncate", isSelected ? "text-app-text" : "text-app-muted group-hover:text-app-text")}>
                                                {config.name || config.host}
                                            </div>
                                            {hasConflict && (
                                                <div className="mt-0.5 text-[11px] text-app-muted truncate">
                                                    Existing: {matchedConnection?.name || matchedConnection?.host}
                                                </div>
                                            )}
                                        </div>

                                        <div className="min-w-0 text-[11px] text-app-muted">
                                            <div className="truncate">{config.host}:{config.port || 22}</div>
                                            <div className="mt-0.5 flex items-center gap-1 truncate">
                                                <OSIcon icon="Terminal" className="w-3 h-3 opacity-70" />
                                                <span className="truncate">{config.username}</span>
                                            </div>
                                        </div>

                                        <div
                                            className="shrink-0 self-center"
                                            onClick={(event) => event.stopPropagation()}
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.stopPropagation();
                                                }
                                            }}
                                            onKeyUp={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.stopPropagation();
                                                }
                                            }}
                                        >
                                            <Select
                                                value={decisions[config.id] || row.recommended}
                                                onChange={(value) => updateDecision(config.id, value as ImportResolution)}
                                                options={RESOLUTION_OPTIONS}
                                                showSearch={false}
                                                showCheck={false}
                                                portal
                                                triggerClassName={IMPORT_ACTION_TRIGGER_CLASS}
                                                className={IMPORT_ACTION_SELECT_CLASS}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="sticky bottom-0 z-10 px-5 py-2.5 border-t border-app-border bg-app-bg/90 backdrop-blur-sm flex justify-end gap-3 shrink-0">
                    {importReport ? (
                        <Button size="sm" onClick={onClose}>Done</Button>
                    ) : (
                        <>
                            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
                            <Button
                                size="sm"
                                disabled={selectedCount === 0 || isLoading}
                                onClick={handleImport}
                            >
                                Import {selectedCount > 0 ? `(${selectedCount})` : ''}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </Modal>
    );
}

registerModal('importSsh', ImportSshModal);
