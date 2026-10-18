import { fileActionBlocked, fileErrorMessage as editorSaveErrorMessage, filePermissionFailure, nativeAccessAvailability, type FilePermissionMetadata } from './filePermissions';
export { editorSaveErrorMessage };

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
    openPermissions?: () => void;
    openingPermissions?: boolean;
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
    const access = nativeAccessAvailability(metadata.writeAccess);
    if (fileActionBlocked(access)) {
        return { state: 'readOnly', reason: access.reason, overridable: false };
    }
    if (metadata.binding.model === 'windows' && metadata.readOnly === true) {
        return { state: 'readOnly', reason: 'The file has the read-only attribute. Change it before saving.', overridable: false };
    }
    const mode = metadata.snapshot.mode;
    if (metadata.binding.model === 'posix' && metadata.writeAccess !== true && mode != null && (mode & 0o222) === 0) {
        return { state: 'readOnly', reason: 'No write permission bits are set. Only allow save attempts if your account has additional access.', overridable: true };
    }
    return uncheckedEditorSavePolicy;
}

export function editorSaveBlocked(access?: EditorSavePolicy): boolean {
    return access?.state === 'checking' || access?.state === 'readOnly';
}

/** Quiet control-flow rejection: the inline status already explains this case. */
export class EditorSaveBlockedError extends Error {}

/** Match filesystem denial messages, not arbitrary filenames containing them. */
export function isEditorWriteDenied(error: unknown): boolean {
    return filePermissionFailure(editorSaveErrorMessage(error)) !== null;
}
