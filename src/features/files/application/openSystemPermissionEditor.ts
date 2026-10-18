import { acquireFileDestination } from './fileDestinationReservations';
import type { FilePermissionMetadata } from '../domain/filePermissions';

/** Explicit host-owned OS handoff, shared by Properties and the read-only editor.
 * The native side repeats support/context/admission checks. Success means only
 * that Windows settings were invoked, never that an ACL or content was changed.
 */
export async function openSystemPermissionEditor(connectionId: string, metadata: FilePermissionMetadata): Promise<void> {
    if (!metadata.systemEditor || connectionId !== 'local' || metadata.binding.model !== 'windows') {
        throw new Error('The Windows permission editor is unavailable for this item.');
    }
    const reservation = acquireFileDestination(connectionId, metadata.path);
    try {
        await window.ipcRenderer.invoke('fs_permissions_open_system_editor', { connectionId, expected: metadata });
    } finally { reservation.release(); }
}
