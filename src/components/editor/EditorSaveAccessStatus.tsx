import { useId } from 'react';
import { LockKeyhole, RefreshCw } from 'lucide-react';
import type { EditorSaveAccess } from '../../features/files/domain/editorSaveAccess';
import { Button } from '../ui/Button';
import { MenuSubmenu } from '../ui/MenuSubmenu';

/** Shared, quiet toolbar explanation; never replaces or clears the editor draft. */
export function EditorSaveAccessStatus({ access }: { access?: EditorSaveAccess }) {
    const descriptionId = useId();
    if (!access || (access.state !== 'checking' && access.state !== 'readOnly')) return null;
    if (access.state === 'checking') {
        return <span role="status" className="inline-flex min-w-0 items-center gap-1.5 truncate text-[11px] text-app-muted">
            <LockKeyhole aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Checking permissions…</span>
        </span>;
    }
    return <div className="min-w-0 text-[11px] text-app-muted">
        <span role="status" className="sr-only">Read-only file. {access.reason}</span>
        <MenuSubmenu label="Read-only file" icon={<LockKeyhole size={13} />} descriptionId={descriptionId}
            localKeyboard triggerClassName="h-7 min-h-7 gap-1.5 px-1.5 py-0 text-[11px] !text-app-muted">
            <p id={descriptionId} className="px-3 py-2 text-xs leading-relaxed text-app-muted">{access.reason}</p>
            <Button type="button" role="menuitem" variant="ghost" size="sm" className="w-full justify-start gap-2 rounded-none px-3 text-xs" disabled={access.openingPermissions} onClick={access.refresh}>
                <RefreshCw aria-hidden="true" size={13} />Check permissions again
            </Button>
            {access.openPermissions && <Button type="button" role="menuitem" variant="ghost" size="sm"
                className="w-full justify-start rounded-none px-3 text-xs" disabled={access.openingPermissions}
                onClick={access.openPermissions}>Windows permissions…</Button>}
            {access.overridable && <>
                <div role="separator" className="my-1 border-t border-app-border" />
                <p className="px-3 py-1 text-[11px] leading-relaxed text-app-muted">
                    Advanced · For this open file only. Does not change permissions, grant access or use sudo.
                </p>
                <Button type="button" role="menuitem" variant="ghost" size="sm" className="w-full justify-start rounded-none px-3 text-xs" onClick={access.enableSaving}>
                    Allow save attempts
                </Button>
            </>}
        </MenuSubmenu>
    </div>;
}
