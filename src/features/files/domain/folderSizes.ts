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
export type FolderSizeState = { status: 'queued' | 'calculating' | 'cancelled' }
    | { status: 'finished'; report: FolderSizeReport }
    | { status: 'unavailable'; reason: string };

export const MAX_FOLDER_SIZE_BATCH = 64;

/** Retain at most one beyond admission to explain truncation, even for huge listings. */
export function folderSizePaths(files: Iterable<{ type: string; path: string }>): string[] {
    const paths: string[] = [];
    for (const file of files) {
        if (file.type === 'd') paths.push(file.path);
        if (paths.length > MAX_FOLDER_SIZE_BATCH) break;
    }
    return paths;
}

export function folderSizeHint(state: FolderSizeState): string {
    switch (state.status) {
        case 'queued': return 'Waiting for the current folder-size scan.';
        case 'calculating': return 'Calculating logical file bytes. No file contents are read.';
        case 'cancelled': return 'Folder-size calculation cancelled. No files were changed.';
        case 'unavailable': return state.reason;
        case 'finished': return state.report.complete
            ? 'Logical file bytes observed during this scan. Not disk space used.'
            : `Incomplete result: ${state.report.reason}. Click for details.`;
    }
}
