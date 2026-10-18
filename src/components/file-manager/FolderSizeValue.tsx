import { Info, Loader2 } from 'lucide-react';
import { folderSizeHint, type FolderSizeState } from '../../features/files/domain/folderSizes';
import { formatBytes } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import { Tooltip } from '../ui/Tooltip';
import { IconButton } from '../ui/IconButton';

/** Shared list/Properties presentation; incomplete totals are never labelled exact. */
export function FolderSizeValue({ state, compact = false, onDetails }: { state?: FolderSizeState; compact?: boolean; onDetails: () => void }) {
    if (!state) return <>—</>;
    const pending = state.status === 'queued' || state.status === 'calculating';
    const report = state.status === 'finished' ? state.report : null;
    const hint = folderSizeHint(state);
    const showInfo = state.status === 'unavailable' || (report && !report.complete);
    const label = report ? `${report.complete ? '' : 'Partial · '}${formatBytes(Number(report.bytes))}`
        : state.status === 'queued' ? 'Queued' : state.status === 'calculating' ? 'Calculating…'
        : state.status === 'cancelled' ? 'Cancelled' : 'Unavailable';
    return <span className="inline-flex min-w-0 max-w-full items-center gap-1" data-folder-size-state={state.status} aria-label={label}>
        {state.status === 'calculating' && <Loader2 size={11} aria-hidden="true" className="shrink-0 animate-spin motion-reduce:animate-none" />}
        {!compact && (report && !report.complete ? <span className="flex min-w-0 flex-col leading-tight">
            <span className="truncate">Partial</span><span className="truncate">{formatBytes(Number(report.bytes))}</span>
        </span> : state.status === 'calculating' ? null : <span className="truncate">{pending ? '—' : label}</span>)}
        {showInfo && <Tooltip content={`${label}. ${hint}`} contentClassName="max-w-xs whitespace-normal">
            <IconButton label="Folder-size details" className="h-5 w-5 text-app-muted" icon={<Info size={12} />}
                onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}
                onKeyDown={event => event.stopPropagation()}
                onClick={event => { event.stopPropagation(); onDetails(); }} />
        </Tooltip>}
    </span>;
}

/** One dialog per Files surface, not one mounted dialog/hook set per file tile. */
export function FolderSizeDetails({ state, onClose, restoreFocus }: { state?: FolderSizeState; onClose: () => void; restoreFocus: boolean }) {
    const report = state?.status === 'finished' ? state.report : null;
    return <Modal isOpen={Boolean(state)} onClose={onClose} restoreFocus={restoreFocus} title="Folder-size details" width="max-w-sm">
        <div className="space-y-2 text-xs text-app-text">
            <p>{state && folderSizeHint(state)}</p>
            {report && <>
                <p>{report.complete ? 'Traversal finished' : 'Incomplete result'} · {report.bytes} logical bytes</p>
                <p>{report.entries.toLocaleString()} entries scanned · {report.files.toLocaleString()} files · {report.folders.toLocaleString()} folders</p>
                <p>{report.errors.toLocaleString()} inaccessible or changed entries · {report.skipped.toLocaleString()} links or special entries skipped</p>
                <p>{(report.elapsedMs / 1000).toFixed(1)} seconds elapsed</p>
            </>}
            <p className="text-app-muted">Files can change during a scan. This is not a snapshot, disk allocation or a guaranteed lower bound. Hard links count per entry. Links are not followed; hidden files and mounted folders are included within the limits.</p>
        </div>
    </Modal>;
}
