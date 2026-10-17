import type { FilePermissionMetadata, FilePermissionOutcome } from '../../../src/features/files/domain/filePermissions';

/** Isolated permission boundary for the real Files component; mutations are opt-in.
 * This fixture cannot reach native IPC, real paths, hosts or account credentials.
 */
export function createPermissionFixture(enabled: boolean, editorEnabled = false) {
    let session = 'fixture-channel';
    let model: FilePermissionMetadata['binding']['model'] = 'posix';
    let mode = 0o102640;
    let kind: FilePermissionMetadata['snapshot']['kind'] = 'File';
    let nextOutcome: FilePermissionOutcome['status'] = 'verified';
    let deferredRead = false;
    let deferredApply = false;
    let resolveRead: (() => void) | undefined;
    let resolveApply: (() => void) | undefined;
    let deferRefresh = false;
    let rejectRefresh: (() => void) | undefined;
    const reads: string[] = [];
    const writes: { path: string; setBits: number; clearBits: number }[] = [];
    const editorWrites: { path: string; content: string }[] = [];
    let readError = false;
    let writeError: string | null = null;
    const metadata = (path: string): FilePermissionMetadata => ({
        path, canonicalParent: path.slice(0, path.lastIndexOf('/')),
        binding: { identity: 'fixture-account', session, model },
        snapshot: { kind, size: 42, modified: 10, mode: model === 'posix' ? mode : null },
        uid: 0, gid: 123, linkCount: null, readOnly: model === 'windows' ? true : null,
        editUnavailable: model !== 'posix' ? 'Windows uses access-control lists. POSIX mode editing is not supported here.'
            : kind !== 'File' && kind !== 'Directory' ? 'Links and special entries are not editable.' : null,
    });
    return {
        handles: (command: string) => command === 'fs_permissions_read' || command === 'fs_permissions_apply'
            || (editorEnabled && (command === 'fs_read_file' || command === 'fs_write_file')),
        invoke: async (command: string, args: Record<string, unknown>) => {
            if (editorEnabled && command === 'fs_read_file') return `Fixture content for ${String(args.path)}\n`;
            if (editorEnabled && command === 'fs_write_file') {
                editorWrites.push({ path: String(args.path), content: String(args.content) });
                if (writeError) throw writeError; // Exercise Tauri's string rejection, not just Error objects.
                return;
            }
            if (command === 'fs_permissions_read') {
                const path = String(args.path);
                reads.push(path);
                if (readError) throw new Error('Simulated permission metadata unavailable');
                const captured = metadata(path);
                if (deferredRead) {
                    deferredRead = false;
                    await new Promise<void>(resolve => { resolveRead = resolve; });
                }
                return captured;
            }
            if (!enabled) throw new Error('Permission mutations are disabled in the normal UI fixture');
            const expected = args.expected as FilePermissionMetadata;
            if (expected.binding.session !== session) throw new Error('Connection changed. Refresh permissions before editing.');
            const setBits = Number(args.setBits), clearBits = Number(args.clearBits);
            writes.push({ path: expected.path, setBits, clearBits });
            if (deferredApply) {
                deferredApply = false;
                await new Promise<void>(resolve => { resolveApply = resolve; });
            }
            if (nextOutcome === 'verified' || nextOutcome === 'adjusted') mode = (mode | setBits) & ~clearBits;
            return { status: nextOutcome, metadata: nextOutcome === 'verified' || nextOutcome === 'adjusted' ? metadata(expected.path) : null,
                message: nextOutcome === 'verified' ? 'Permissions updated; current mode verified.'
                    : 'Permission change outcome requires review. Refresh to check the current mode.' } satisfies FilePermissionOutcome;
        },
        control: {
            reads, writes, editorWrites,
            failRead: (value: boolean) => { readError = value; },
            failWrite: (value: string | null) => { writeError = value; },
            setModel: (value: typeof model) => { model = value; },
            setKind: (value: typeof kind) => { kind = value; },
            setMode: (value: number) => { mode = value; },
            setOutcome: (value: typeof nextOutcome) => { nextOutcome = value; },
            reconnect: () => { session += '-new'; },
            deferRead: () => { deferredRead = true; },
            finishRead: () => { resolveRead?.(); resolveRead = undefined; },
            readPending: () => Boolean(resolveRead),
            deferApply: () => { deferredApply = true; },
            finishApply: () => { resolveApply?.(); resolveApply = undefined; },
            applyPending: () => Boolean(resolveApply),
            deferRefresh: () => { deferRefresh = true; },
            refreshPending: () => Boolean(rejectRefresh),
            rejectRefresh: () => { rejectRefresh?.(); rejectRefresh = undefined; },
            awaitListingRefresh: async () => {
                if (!deferRefresh) return;
                deferRefresh = false;
                await new Promise<void>((_, reject) => { rejectRefresh = () => reject(new Error('Simulated listing refresh failure')); });
            },
        },
    };
}
