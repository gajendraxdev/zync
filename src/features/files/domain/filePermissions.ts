/** Selected-target native metadata, not listing strings or an effective-access claim. */
export interface FilePermissionMetadata {
    binding: { identity: string; session: string; model: 'posix' | 'windows' | 'unknown' };
    path: string;
    canonicalParent: string;
    /** Opaque decimal evidence: native byte counts/timestamps may exceed JS safe integers. */
    snapshot: { kind: 'File' | 'Directory' | 'Symlink' | 'Other'; size: string; modified: string | null; mode: number | null };
    uid: number | null;
    gid: number | null;
    linkCount: number | null;
    readOnly: boolean | null;
    /** Optional native local check; unavailable/remote access remains unknown. */
    writeAccess?: boolean | null;
    /** Local OS-owned editor, not a POSIX mode or an app-owned ACL transaction. */
    systemEditor?: boolean;
    localIdentity?: string | null;
    editUnavailable: string | null;
}

export interface FilePermissionOutcome {
    status: 'verified' | 'adjusted' | 'appliedUnverified' | 'rejected' | 'unknown';
    metadata: FilePermissionMetadata | null;
    message: string;
}

/** Short-lived native review, not a saved credential or reusable root session. */
export interface AdministratorPermissionReply {
    challengeId: string;
    reviewToken: string | null;
    status: 'password' | 'prepared' | 'finished';
    metadata: FilePermissionMetadata | null;
    outcome: FilePermissionOutcome | null;
}

/** Support and account access are distinct. Unknown access remains attemptable. */
export type FileActionAvailability =
    | { state: 'allowed' | 'unknown'; reason: string }
    | { state: 'denied' | 'unsupported'; reason: string };

/** Optional native evidence, not POSIX-mode inference or an authorization grant. */
export interface FileAccessEvidence {
    directory: string;
    target: string | null;
    directoryAccess: { createFile: boolean | null; createFolder: boolean | null };
    targetAccess: { read: boolean | null; write: boolean | null; rename: boolean | null; delete: boolean | null };
}

export type FileAccessAction = 'createFile' | 'createFolder' | 'receive' | 'read' | 'write' | 'rename' | 'delete';

export function fileErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message;
    return typeof error === 'string' && error ? error : 'Unknown filesystem error';
}

/** Classify native failure reasons, never denial phrases inside a filename. */
export function filePermissionFailure(message: string): 'denied' | 'readOnly' | null {
    const reason = (message.includes(': ') ? message.slice(message.lastIndexOf(': ') + 2) : message).trim();
    if (/^(?:permission denied|operation not permitted|access is denied)[.:]?(?:\s*\(os error \d+\))?$/i.test(reason)
        || /^(?:Error:\s*)?(?:EACCES|EPERM)(?=$|[\s:])/.test(message)) return 'denied';
    if (/^read-only file system[.:]?(?:\s*\(os error \d+\))?$/i.test(reason)
        || /^(?:Error:\s*)?EROFS(?=$|[\s:])/.test(message)) return 'readOnly';
    return null;
}

/** One projection for buttons, menus, shortcuts and handlers. Unknown stays
 * attemptable; file write access must never stand in for parent delete rights.
 * `receive` may contain mixed file/folder items, so both creation rights must be
 * denied before blocking the whole batch. Native operations remain authoritative.
 */
export function fileActionAvailability(evidence: FileAccessEvidence | null, action: FileAccessAction): FileActionAvailability {
    if (!evidence) return nativeAccessAvailability(null);
    const permitted = action === 'receive'
        ? evidence.directoryAccess.createFile === false && evidence.directoryAccess.createFolder === false ? false : null
        : action === 'createFile' || action === 'createFolder' ? evidence.directoryAccess[action] : evidence.targetAccess[action];
    return nativeAccessAvailability(permitted);
}

export function nativeAccessAvailability(permitted: boolean | null | undefined): FileActionAvailability {
    if (permitted === false) return { state: 'denied', reason: 'The local access check denies this action for the current account. Refresh to check again.' };
    // A positive DACL check does not account for locks, remote shares or a later
    // policy change. Do not present it as a promise that the operation will work.
    return { state: 'unknown', reason: 'The filesystem checks access when the operation runs.' };
}

export function fileActionBlocked(availability: FileActionAvailability): boolean {
    return availability.state === 'denied' || availability.state === 'unsupported';
}

export function modeEditAvailability(metadata: FilePermissionMetadata): FileActionAvailability {
    if (metadata.editUnavailable) return { state: 'unsupported', reason: metadata.editUnavailable };
    if (metadata.systemEditor) return { state: 'unknown', reason: 'Windows manages account permissions and inheritance. Open Windows Properties, then choose Security. Administrator authorization stays in Windows.' };
    return { state: 'unknown', reason: 'The filesystem checks the current account when you apply. Mode bits do not prove effective access.' };
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
