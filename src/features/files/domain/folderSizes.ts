/** Logical regular-file bytes observed during a bounded scan, never allocated disk space. */
export interface FolderSizeReport {
    bytes: string;
    entries: number;
    files: number;
    folders: number;
    skipped: number;
    errors: number;
    elapsedMs: number;
    complete: boolean;
    reason: string;
}
export type FolderSizeState = { status: 'calculating' | 'cancelled' }
    | { status: 'finished'; report: FolderSizeReport }
    | { status: 'unavailable'; reason: string };

/** Explain the observed scan state without equating logical bytes with allocated disk space. */
export function folderSizeHint(state: FolderSizeState): string {
    switch (state.status) {
        case 'calculating': return 'Calculating logical file bytes. No file contents are read.';
        case 'cancelled': return 'Folder-size calculation cancelled. No files were changed.';
        case 'unavailable': return state.reason;
        case 'finished': return state.report.complete
            ? 'Logical file bytes observed during this scan. Not disk space used.'
            : `Incomplete result: ${state.report.reason}.`;
    }
}
