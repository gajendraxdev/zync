/** Selected-target native metadata, not listing strings or an effective-access claim. */
export interface FilePermissionMetadata {
    binding: { identity: string; session: string; model: 'posix' | 'windows' | 'unknown' };
    path: string;
    canonicalParent: string;
    snapshot: { kind: 'File' | 'Directory' | 'Symlink' | 'Other'; size: number; modified: number | null; mode: number | null };
    uid: number | null;
    gid: number | null;
    linkCount: number | null;
    readOnly: boolean | null;
    editUnavailable: string | null;
}

export interface FilePermissionOutcome {
    status: 'verified' | 'adjusted' | 'appliedUnverified' | 'rejected' | 'unknown';
    metadata: FilePermissionMetadata | null;
    message: string;
}

/** Support and account access are distinct. Unknown access remains attemptable. */
export type FileActionAvailability =
    | { state: 'allowed' | 'unknown'; reason: string }
    | { state: 'denied' | 'unsupported'; reason: string };

export function modeEditAvailability(metadata: FilePermissionMetadata): FileActionAvailability {
    if (metadata.editUnavailable) return { state: 'unsupported', reason: metadata.editUnavailable };
    return { state: 'unknown', reason: 'The server checks the current account when you apply. Mode bits do not prove effective access.' };
}

/** Strictly three ordinary octal digits; special bits are never edited here. */
export function parseOrdinaryMode(value: string): number | null {
    return /^[0-7]{3}$/.test(value) ? Number.parseInt(value, 8) : null;
}

export function ordinaryMode(mode: number): string {
    return (mode & 0o777).toString(8).padStart(3, '0');
}

/** Minimal disjoint changes, preserving the freshly checked native special bits. */
export function permissionMasks(base: number, draft: string): { setBits: number; clearBits: number } {
    const next = parseOrdinaryMode(draft);
    if (next == null) throw new Error('Enter exactly three octal digits (0–7).');
    return { setBits: next & ~base & 0o777, clearBits: base & ~next & 0o777 };
}

/** Shared read-only symbolic display, including existing setuid/setgid/sticky bits. */
export function unixModeString(octal: string): string {
    if (!/^[0-7]{3,4}$/.test(octal)) return '—';
    const mode = Number.parseInt(octal, 8);
    return [6, 3, 0].map((shift, index) => {
        const bits = mode >> shift;
        const special = mode & [0o4000, 0o2000, 0o1000][index];
        const mark = index === 2 ? 't' : 's';
        return `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${special ? (bits & 1 ? mark : mark.toUpperCase()) : bits & 1 ? 'x' : '-'}`;
    }).join('');
}
