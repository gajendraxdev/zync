import type { StoreApi } from 'zustand/vanilla';
import type { AppStore } from '../../../src/store/useAppStore';
import type { FileEntry } from '../../../src/components/file-manager/types';
import type { NativeFileTransferReceipt } from '../../../src/features/files/application/nativeFileTransfer';

interface SimulatedCall {
    command: string;
    args: Record<string, unknown>;
}

interface PendingWrite {
    id: string;
    transferId?: string;
    destination: string;
    source?: string;
    move: boolean;
    resolve: (value?: unknown) => void;
    reject: (error: Error) => void;
    receipt?: NativeFileTransferReceipt;
}

const SIMULATED_COMMANDS = new Set(['fs_exists', 'fs_rename', 'fs_delete', 'fs_copy_batch', 'sftp_put', 'sftp:cancelTransfer', 'fs_transfer_file', 'fs_transfer_inspect', 'fs_transfer_cleanup', 'fs_transfer_history', 'fs_transfer_dismiss']);

/** Opt-in, in-memory native boundary. This module never calls a real filesystem or network API. */
export function createTransferSafetyFixture(host: string, rootPath: string) {
    const calls: SimulatedCall[] = [];
    const files = new Map<string, string>();
    const writes: PendingWrite[] = [];
    const missingOnce = new Set<string>();
    const secondHost = `${host}-second`;
    const secondPath = '/home/other/work';
    const messages: { type: string; message: string }[] = [];
    let store: StoreApi<AppStore> | undefined;
    let cleanupFails = false;
    let dismissFails = false;
    let writeSerial = 0;
    let nativeFiles = false;
    let preparationFails = false;
    const receipts: NativeFileTransferReceipt[] = [];
    let capturedReceipts: NativeFileTransferReceipt[] = [];
    const dismissed = new Set<string>();

    const key = (connectionId: string, path: string) => `${connectionId}:${path}`;
    for (const name of ['README.md', 'package.json', '.env', 'archive.tar.gz']) {
        files.set(key(host, `${rootPath}/${name}`), `original:${name}`);
        files.set(key(host, `/fixture/incoming/${name}`), `incoming:${name}`);
    }

    function text(args: Record<string, unknown>, name: string): string {
        const value = args[name];
        if (typeof value !== 'string' || !value) throw new Error(`Missing simulated ${name}`);
        return value;
    }

    function endpoint(args: Record<string, unknown>, name = 'connectionId'): string {
        const id = text(args, name);
        if (![host, secondHost].includes(id)) throw new Error(`Unexpected simulated endpoint: ${id}`);
        return id;
    }

    function deferWrite(destination: string, source?: string, move = false, transferId?: string): Promise<void> {
        if (writes.length >= 8) throw new Error('The simulation permits at most eight pending writes');
        files.set(destination, 'partial');
        return new Promise<void>((resolve, reject) => {
            writes.push({ id: `write-${++writeSerial}`, transferId, destination, source, move, resolve: () => resolve(), reject });
        });
    }

    async function invoke(command: string, args: Record<string, unknown>): Promise<unknown> {
        if (!SIMULATED_COMMANDS.has(command)) throw new Error(`Mutation unavailable in transfer simulation: ${command}`);
        if (calls.length >= 64) throw new Error('Unexpected unbounded simulated native calls');
        calls.push({ command, args: { ...args } });
        if (command === 'fs_transfer_history') return receipts.filter(receipt => !dismissed.has(receipt.id));
        if (command === 'fs_transfer_dismiss') {
            if (dismissFails) throw new Error('Fixture journal dismissal denied');
            dismissed.add(text(args, 'transferId'));
            const index = receipts.findIndex(receipt => receipt.id === args.transferId);
            if (index >= 0 && (receipts[index].phase === 'completed' && !receipts[index].warning || receipts[index].stageCleaned)) receipts.splice(index, 1);
            return;
        }
        if (command === 'fs_transfer_inspect') {
            const receipt = receipts.find(receipt => receipt.id === args.transferId);
            if (!receipt) throw new Error('Fixture receipt not found');
            const inspect = (path: string) => files.has(key(receipt.destinationConnectionId, path)) ? { kind: 'File', size: 12 } : null;
            const cleanupAvailable = receipt.phase === 'cancelled' && !receipt.stageCleaned;
            return { destination: inspect(receipt.destinationPath), stage: inspect(receipt.stagePath), backup: inspect(receipt.backupPath),
                cleanupAvailable, cleanupBlockedReason: cleanupAvailable ? null : 'Writer completion was not recorded. No automatic cleanup is scheduled.' };
        }
        if (command === 'fs_transfer_cleanup') {
            const index = receipts.findIndex(receipt => receipt.id === args.transferId);
            const receipt = receipts[index];
            if (!receipt || receipt.phase !== 'cancelled') throw new Error('Fixture cleanup not eligible');
            if (cleanupFails) throw new Error('Permission denied');
            files.delete(key(receipt.destinationConnectionId, receipt.stagePath));
            receipts.splice(index, 1);
            return;
        }
        if (command === 'fs_transfer_file') {
            // Legacy checks intentionally model directory-policy fallback. The
            // native-files mode below separately exercises real receipt handling.
            if (!nativeFiles) return null;
            if (preparationFails) throw new Error('TRANSFER_NOT_STARTED:Could not prepare source connection: session closed');
            const id = endpoint(args, 'destinationConnectionId');
            const destinationPath = text(args, 'destinationPath');
            const transferId = text(args, 'transferId');
            const stagePath = `${rootPath}/.zync-transfer-${transferId}.part`;
            const backupPath = `${rootPath}/.zync-transfer-${transferId}.backup`;
            const receipt: NativeFileTransferReceipt = { version: 1, id: transferId,
                sourceConnectionId: text(args, 'sourceConnectionId'), sourcePath: text(args, 'sourcePath'), destinationConnectionId: id, destinationPath,
                stagePath, backupPath, backupExpected: true, phase: 'writing', createdAt: Date.now(), transferred: 0, total: 12,
                destinationUnchanged: true, warning: null, error: null };
            files.set(key(id, stagePath), 'partial');
            return new Promise<unknown>((resolve, reject) => {
                writes.push({ id: `write-${++writeSerial}`, transferId, destination: key(id, destinationPath), move: false, receipt, resolve, reject });
            });
        }
        if (command === 'sftp:cancelTransfer') {
            const id = text(args, 'transferId');
            if (!writes.some(write => write.transferId === id)) throw new Error('Transfer is no longer active');
            return;
        }
        if (command === 'sftp_put') {
            const id = endpoint(args, 'id');
            const destination = key(id, text(args, 'remotePath'));
            const result = deferWrite(destination, undefined, false, text(args, 'transferId'));
            if (args.waitForCompletion === true) return result;
            // Model legacy background admission truthfully, so a premature-cleanup regression fails.
            void result.catch(() => {});
            return;
        }

        const id = endpoint(args);
        if (command === 'fs_copy_batch') {
            if (!Array.isArray(args.operations) || args.operations.length !== 1) throw new Error('Expected one simulated Keep Both copy');
            const operation = args.operations[0] as Record<string, unknown>;
            return deferWrite(key(id, text(operation, 'to')), key(id, text(operation, 'from')));
        }
        if (command === 'fs_exists') {
            const path = key(id, text(args, 'path'));
            // Model a stale/absent stat result while a different operation owns the destination.
            if (missingOnce.delete(path)) return false;
            return files.has(path);
        }
        if (command === 'fs_delete') {
            const path = text(args, 'path');
            if (!path.includes('.zync-backup-')) throw new Error('Only recovery-backup removal is allowed in this fixture');
            if (cleanupFails) throw new Error('Fixture backup cleanup denied');
            files.delete(key(id, path));
            return;
        }
        if (command === 'fs_rename') {
            const from = text(args, 'oldPath');
            const to = text(args, 'newPath');
            const source = key(id, from);
            const destination = key(id, to);
            if (!files.has(source)) throw new Error(`Simulated source not found: ${from}`);
            if (files.has(destination)) throw new Error(`Refusing to overwrite simulated destination: ${to}`);
            if (!to.startsWith(`${from}.zync-backup-`)) return deferWrite(destination, source, true);
            files.set(destination, files.get(source)!);
            files.delete(source);
            return;
        }
        throw new Error(`Unhandled simulated native command: ${command}`);
    }

    function attach(appStore: StoreApi<AppStore>): () => void {
        store = appStore;
        const seenMessages = new Set<string>();
        return store.subscribe(state => {
            for (const toast of state.toasts) {
                if (seenMessages.has(toast.id)) continue;
                seenMessages.add(toast.id);
                messages.push({ type: toast.type, message: toast.message });
            }
        });
    }

    function app(): StoreApi<AppStore> {
        if (!store) throw new Error('The transfer fixture is not attached');
        return store;
    }

    return {
        handles: (command: string) => SIMULATED_COMMANDS.has(command),
        invoke,
        attach,
        control: {
            nativeFiles: () => { nativeFiles = true; },
            preparationFailure: () => { preparationFails = true; },
            dismissFailure: (fail: boolean) => { dismissFails = fail; },
            restoreReceipts: () => { for (const receipt of receipts) if (!dismissed.has(receipt.id)) app().getState().receiveNativeTransfer(receipt); },
            captureReceipts: () => { capturedReceipts = receipts.map(receipt => ({ ...receipt })); },
            replayReceipts: () => { for (const receipt of capturedReceipts) app().getState().receiveNativeTransfer(receipt); },
            resetTransferView: () => { app().setState({ transfers: [] }); },
            stage: (names = ['README.md'], op: 'copy' | 'cut' = 'copy', sameEndpoint = false, sourceDirectory = '/fixture/incoming') => {
                const entries: FileEntry[] = names.map(name => ({ name, path: `${sourceDirectory}/${name}`,
                    type: nativeFiles ? '-' : 'd', size: 12, lastModified: 1, permissions: '644', owner: '', group: '' }));
                app().getState().setClipboard(entries, sameEndpoint ? host : 'local', sourceDirectory, op);
            },
            cleanupFailure: () => { cleanupFails = true; },
            allowCleanup: () => { cleanupFails = false; },
            reportMissingOnce: (path: string) => { missingOnce.add(key(host, path)); },
            settle: (outcome: boolean | 'cancelled', indexOrId: number | string = 0) => {
                const index = typeof indexOrId === 'number' ? indexOrId
                    : writes.findIndex(write => write.id === indexOrId || write.transferId === indexOrId);
                if (index < 0) throw new Error('No simulated native operation matches that identifier');
                const [write] = writes.splice(index, 1);
                if (!write) throw new Error('No simulated native operation is pending');
                if (write.receipt) {
                    const stageCleaned = outcome === 'cancelled' && !cleanupFails;
                    const receipt = { ...write.receipt, phase: outcome === true ? 'completed' : outcome === 'cancelled' ? 'cancelled' : 'failed',
                        destinationUnchanged: outcome !== true, stageCleaned, transferred: 12,
                        warning: outcome === true || stageCleaned ? null : outcome === 'cancelled'
                            ? 'Copy cancelled, but temporary-file cleanup could not be confirmed: Permission denied. Inspect recovery files before cleanup.'
                            : 'Destination left unchanged. A separate staging file may remain; inspect it before cleanup.',
                        error: outcome === true ? null : outcome === 'cancelled' ? 'Cancelled' : 'No space left on device' } as NativeFileTransferReceipt;
                    if (outcome === true) {
                        files.set(write.destination, 'replacement'); files.delete(key(receipt.destinationConnectionId, receipt.stagePath));
                    }
                    if (stageCleaned) files.delete(key(receipt.destinationConnectionId, receipt.stagePath));
                    receipts.push(receipt); write.resolve(receipt); return;
                }
                if (outcome === true) {
                    files.set(write.destination, 'replacement');
                    if (write.move && write.source) files.delete(write.source);
                    write.resolve();
                } else write.reject(new Error(outcome === 'cancelled' ? 'Cancelled' : 'Fixture destination write failed'));
            },
            navigate: (path: string) => app().getState().loadFiles(app().getState().activeConnectionId!, path),
            switchEndpoint: () => {
                app().setState(state => ({ activeConnectionId: secondHost,
                    connections: [...state.connections, { id: secondHost, name: 'Other test host', host: 'other.invalid',
                        port: 22, username: 'other', status: 'connected', homePath: '/home/other' }],
                    currentPath: { ...state.currentPath, [secondHost]: secondPath },
                    files: { ...state.files, [secondHost]: [] },
                }));
            },
            replaceClipboard: () => {
                app().getState().setClipboard([{ name: 'fresh-choice.txt', path: '/new-choice/fresh-choice.txt',
                    type: '-', size: 1, lastModified: 1, permissions: '644', owner: '', group: '' }],
                secondHost, '/new-choice', 'cut');
            },
            snapshot: () => {
                const state = app().getState();
                return { calls, files: Object.fromEntries(files), pending: writes.map(write => write.id),
                    writes: writes.map(write => ({ id: write.id, transferId: write.transferId, destination: write.destination })), messages,
                    transfers: state.transfers, lastAction: state.lastAction, clipboard: state.clipboard, activeConnectionId: state.activeConnectionId,
                    currentPath: state.currentPath, host, rootPath, secondHost, secondPath };
            },
        },
    };
}
