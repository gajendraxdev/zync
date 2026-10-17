import type { FilePermissionMetadata } from './filePermissions';

/** Save policy is advisory; the filesystem still authorizes the actual write. */
export interface EditorSavePolicy {
    state: 'checking' | 'unknown' | 'readOnly';
    reason: string;
    /** Only a mode-bit hint can be bypassed, not a rejected write. */
    overridable: boolean;
}

export interface EditorSaveAccess extends EditorSavePolicy {
    refresh: () => void;
    enableSaving: () => void;
}

export const uncheckedEditorSavePolicy: EditorSavePolicy = {
    state: 'unknown', reason: 'Write access is checked by the filesystem when saving.', overridable: false,
};

/** No write-open, shell command or mutation is used to probe permission. SFTP
 * mode bits do not expose ACLs or privileged-account capabilities, hence the
 * explicit opt-in for a no-write-bit hint rather than an effective-access claim.
 */
export function editorSavePolicy(metadata: FilePermissionMetadata): EditorSavePolicy {
    if (metadata.snapshot.kind !== 'File') return uncheckedEditorSavePolicy;
    if (metadata.binding.model === 'windows' && metadata.readOnly === true) {
        return { state: 'readOnly', reason: 'The file has the read-only attribute. Change it before saving.', overridable: false };
    }
    const mode = metadata.snapshot.mode;
    if (metadata.binding.model === 'posix' && mode != null && (mode & 0o222) === 0) {
        return { state: 'readOnly', reason: 'No write permission bits are set. Only allow save attempts if your account has additional access.', overridable: true };
    }
    return uncheckedEditorSavePolicy;
}

export function editorSaveBlocked(access?: EditorSavePolicy): boolean {
    return access?.state === 'checking' || access?.state === 'readOnly';
}

/** Quiet control-flow rejection: the inline status already explains this case. */
export class EditorSaveBlockedError extends Error {}

export function editorSaveErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error && 'message' in error && typeof error.message === 'string') return error.message;
    return typeof error === 'string' && error ? error : 'Unknown filesystem error';
}

/** Match filesystem denial messages, not arbitrary filenames containing them. */
export function isEditorWriteDenied(error: unknown): boolean {
    const message = editorSaveErrorMessage(error);
    // Native errors append the OS/SFTP reason after the path. Matching only
    // that tail avoids mistaking a colon or denial phrase *inside* a filename
    // for a permission rejection (for example when the real error is ENOSPC).
    const tail = message.slice(message.lastIndexOf(': ') + 2).trim();
    const reason = message.includes(': ') ? tail : message.trim();
    return /^(?:permission denied|operation not permitted|access is denied|read-only file system)[.:]?(?:\s*\(os error \d+\))?$/i.test(reason)
        || /^(?:Error:\s*)?(?:EACCES|EPERM|EROFS)(?=$|[\s:])/.test(message);
}
