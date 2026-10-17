import { createStore } from 'zustand/vanilla';
import { createTransferSlice } from '../src/store/transferSlice';
import { acquireFileDestination } from '../src/features/files/application/fileDestinationReservations';
import type { AppStore } from '../src/store/useAppStore';
import type { FileEntry } from '../src/components/file-manager/types';
import { bindNotifyDispatcher, unbindNotifyDispatcher } from '../src/features/notifications';

interface ListingRequest {
    connectionId: string;
    path: string;
    resolve: (entries: FileEntry[]) => void;
}

function equal(actual: unknown, expected: unknown, message: string): void {
    if (!Object.is(actual, expected)) {
        throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
    }
}

function sameValues(actual: unknown, expected: unknown, message: string): void {
    equal(JSON.stringify(actual), JSON.stringify(expected), message);
}

const requests: ListingRequest[] = [];
let nativeOverride: ((command: string, args: unknown) => Promise<unknown>) | null = null;
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    ipcRenderer: { invoke(command: string, args: { connectionId: string; path: string }) {
        if (nativeOverride) return nativeOverride(command, args);
        equal(command, 'fs_list', 'Refresh must issue directory reads only');
        if (requests.length >= 8) throw new Error('Unexpected unbounded refresh requests');
        return new Promise<FileEntry[]>(resolve => requests.push({ ...args, resolve }));
    } },
} });

// The real slice captures its native bridge during module initialization.
const { acknowledgeMovedClipboard, createFileSystemSlice, filesStoreKey } = await import('../src/store/fileSystemSlice');
let serial = 0;

function fixture() {
    const connectionId = `refresh-fixture-${++serial}`;
    // Other application slices are intentionally absent: accidental cross-feature access must fail.
    const store = createStore<AppStore>()((...args) => {
        const initial: Partial<AppStore> = {
            ...createFileSystemSlice(...args),
            ...createTransferSlice(...args),
            connections: [],
            disconnect: () => { throw new Error('A refresh must not disconnect this fixture'); },
            setLastAction: () => {},
        };
        return initial as AppStore;
    });
    return { store, connectionId };
}

function entry(name: string, folder: string): FileEntry {
    return { name, path: `${folder}/${name}`, type: '-', size: 1, lastModified: 1,
        permissions: '644', owner: '', group: '' };
}

function takeRequest(path: string): ListingRequest {
    const index = requests.findIndex(request => request.path === path);
    if (index === -1) throw new Error(`Expected a listing request for ${path}`);
    return requests.splice(index, 1)[0];
}

async function run(name: string, test: () => Promise<void>): Promise<void> {
    equal(requests.length, 0, 'Previous test must finish all native reads');
    await test();
    equal(requests.length, 0, 'Every expected native read must be consumed');
    console.log(`  ok ${name}`);
}

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

try {
    await run('a connection refresh reads the base and every split instance at its own path', async () => {
        const { store, connectionId } = fixture();
        const left = filesStoreKey(connectionId, 'left');
        const right = filesStoreKey(connectionId, 'right');
        const histories = { [connectionId]: ['/base'], [left]: ['/left'], [right]: ['/right'] };
        store.setState({ currentPath: { [connectionId]: '/base', [left]: '/left', [right]: '/right' },
            history: histories, historyIndex: { [connectionId]: 0, [left]: 0, [right]: 0 } });

        let finished = false;
        const refresh = store.getState().refreshConnectionFiles(connectionId).then(() => { finished = true; });
        sameValues(requests.map(request => request.path).sort(), ['/base', '/left', '/right'], 'Refresh each listing once');
        equal(store.getState().isLoading[left], undefined, 'Background refresh must not replace the listing with a spinner');
        const base = takeRequest('/base');
        const leftRequest = takeRequest('/left');
        const rightRequest = takeRequest('/right');
        for (const request of [base, leftRequest, rightRequest]) equal(request.connectionId, connectionId, 'Use the actual endpoint identity');
        base.resolve([entry('base-result', '/base')]);
        leftRequest.resolve([entry('left-result', '/left')]);
        await Promise.resolve();
        equal(finished, false, 'The refresh promise must include every instance');
        rightRequest.resolve([entry('right-result', '/right')]);
        await refresh;

        equal(store.getState().files[left][0].name, 'left-result', 'Keep split results independent');
        equal(store.getState().files[right][0].name, 'right-result', 'Keep the other split independent');
        sameValues(store.getState().history, histories, 'Refresh must preserve navigation history');
    });

    await run('a split-only connection refresh does not require a base listing or match another host prefix', async () => {
        const { store, connectionId } = fixture();
        const pane = filesStoreKey(connectionId, 'pane');
        const unrelatedId = `${connectionId}-other`;
        const unrelatedPane = filesStoreKey(unrelatedId, 'pane');
        const untouched = [entry('unrelated', '/unrelated')];
        store.setState({ currentPath: { [pane]: '/pane', [unrelatedId]: '/unrelated',
            [unrelatedPane]: '/unrelated-pane', [filesStoreKey(connectionId, 'unresolved')]: '' },
        files: { [unrelatedId]: untouched } });

        const refresh = store.getState().refreshConnectionFiles(connectionId);
        equal(requests.length, 1, 'Only the resolved matching instance needs a read');
        takeRequest('/pane').resolve([entry('pane-result', '/pane')]);
        await refresh;
        equal(store.getState().files[pane][0].name, 'pane-result', 'Refresh the split without a base key');
        equal(store.getState().currentPath[connectionId], undefined, 'Do not create a base path');
        equal(store.getState().files[unrelatedId], untouched, 'Do not touch a similarly named endpoint');
        equal(store.getState().files[unrelatedPane], undefined, 'Do not load its split instance');
    });

    await run('completion refresh uses the current folder rather than a former transfer destination', async () => {
        const { store, connectionId } = fixture();
        store.getState().setPath(connectionId, '/transfer-destination', 'pane');
        store.getState().setPath(connectionId, '/user-current-folder', 'pane');
        const refresh = store.getState().refreshConnectionFiles(connectionId);
        equal(requests.length, 1, 'Read the currently open folder once');
        takeRequest('/user-current-folder').resolve([]);
        await refresh;
        equal(store.getState().currentPath[filesStoreKey(connectionId, 'pane')], '/user-current-folder', 'Do not navigate back after a transfer');
    });

    await run('navigation started during a refresh wins over its late listing reply', async () => {
        const { store, connectionId } = fixture();
        const pane = filesStoreKey(connectionId, 'pane');
        store.getState().setPath(connectionId, '/old', 'pane');
        const refresh = store.getState().refreshConnectionFiles(connectionId);
        const old = takeRequest('/old');
        const navigation = store.getState().loadFiles(connectionId, '/new', false, false, 'pane');
        takeRequest('/new').resolve([entry('new-result', '/new')]);
        await navigation;
        old.resolve([entry('stale-result', '/old')]);
        await refresh;
        equal(store.getState().currentPath[pane], '/new', 'The old refresh cannot undo navigation');
        equal(store.getState().files[pane][0].name, 'new-result', 'The old refresh cannot replace the newer listing');
    });

    await run('a connection without an open resolved path performs no work', async () => {
        const { store, connectionId } = fixture();
        await store.getState().refreshConnectionFiles(connectionId);
        equal(requests.length, 0, 'Do not open a file manager implicitly');
    });

    await run('same-endpoint copy cancellation is quiet without hiding an uncertain close', async () => {
        for (const error of ['Cancelled', 'Cancelled; destination close failed']) {
            const { store, connectionId } = fixture();
            const messages: string[] = [];
            store.getState().setPath(connectionId, '/destination');
            const source = entry('source', '/source');
            store.getState().setClipboard([source], connectionId, '/source', 'copy');
            bindNotifyDispatcher((_type, message) => messages.push(message));
            nativeOverride = async command => {
                if (command === 'fs_exists') return false;
                equal(command, 'fs_copy_batch', 'Keep the existing same-endpoint copy route');
                throw error;
            };
            try {
                equal(await store.getState().pasteEntries(connectionId, [source.path], 'copy'), false, 'Cancellation/failure never reports success');
                equal(messages.length, error === 'Cancelled' ? 0 : 1, 'Only a genuine failure needs a notification');
                equal(store.getState().isLoading[connectionId], false, 'Finish the browsing loading state');
                const reservation = acquireFileDestination(connectionId, '/destination/source');
                reservation.release();
            } finally {
                nativeOverride = null;
                unbindNotifyDispatcher();
            }
        }
    });

    await run('a failed same-endpoint move returns failure and preserves the cut clipboard', async () => {
        for (const error of ['Destination write denied', 'DISCONNECTED: Rename outcome unconfirmed']) {
            const { store, connectionId } = fixture();
            store.getState().setPath(connectionId, '/destination');
            const source = entry('source', '/source');
            store.getState().setClipboard([source], connectionId, '/source', 'cut');
            const clipboard = store.getState().clipboard;
            nativeOverride = async command => {
                if (command === 'fs_exists') return false;
                equal(command, 'fs_rename_batch', 'Only the requested move may mutate');
                throw error;
            };
            try {
                const moved = await store.getState().pasteEntries(connectionId, [source.path], 'cut');
                equal(moved, false, 'A swallowed mutation failure cannot be mistaken for success');
                equal(store.getState().clipboard, clipboard, 'Retain the original clipboard for review');
            } finally {
                nativeOverride = null;
            }
        }
    });

    await run('acknowledged moves remove only the original cut entries on the matching endpoint', async () => {
        const first = entry('first', '/source');
        const second = entry('second', '/source');
        const clipboard = { intentId: 'original-cut', files: [first, second], sourceConnectionId: 'host', sourcePath: '/source', op: 'cut' as const };
        const partial = acknowledgeMovedClipboard(clipboard, clipboard, 'host', [first.path]);
        sameValues(partial?.files, [second], 'Retain unresolved cut entries');
        equal(partial?.intentId, clipboard.intentId, 'Partial acknowledgement retains the original intent identity');
        equal(acknowledgeMovedClipboard(clipboard, clipboard, 'different-host', [first.path]), clipboard, 'Other endpoint acknowledgements cannot clear this cut');
        const copied = { ...clipboard, op: 'copy' as const };
        equal(acknowledgeMovedClipboard(copied, copied, 'host', [first.path]), copied, 'Copy intent remains reusable');
        const newer = { ...clipboard, intentId: 'newer-cut' };
        equal(acknowledgeMovedClipboard(newer, clipboard, 'host', [first.path]), newer, 'Do not modify a newer user intent');
        equal(acknowledgeMovedClipboard(clipboard, null, 'host', [first.path]), clipboard, 'An absent captured intent cannot authorize acknowledgement');
        equal(acknowledgeMovedClipboard(clipboard, clipboard, 'host', ['/unknown']), clipboard, 'Unknown paths do not alter clipboard identity');
        equal(acknowledgeMovedClipboard(partial, clipboard, 'host', [second.path]), null, 'A concurrent completion can acknowledge against the original captured intent');
    });

    await run('a confirmed partial move preserves the unattempted cut entries and newer clipboard', async () => {
        const { store, connectionId } = fixture();
        const first = entry('first', '/source');
        const second = entry('second', '/source');
        store.getState().setPath(connectionId, '/destination');
        store.getState().setClipboard([first, second], connectionId, '/source', 'cut');
        const sourceKey = filesStoreKey(connectionId, 'source');
        store.setState({ files: { [sourceKey]: [first, second] } });
        const submitted = deferred();
        const mutation = deferred();
        nativeOverride = async command => {
            if (command === 'fs_exists') return false;
            equal(command, 'fs_rename_batch', 'Only the requested move may mutate');
            submitted.resolve(); await mutation.promise;
        };
        try {
            const moved = store.getState().pasteEntries(connectionId, [first.path], 'cut');
            await submitted.promise;
            mutation.resolve();
            equal(await moved, true, 'Success requires the native batch acknowledgement');
            sameValues(store.getState().clipboard?.files, [second], 'Acknowledge only this successful subset');

            const nextSubmitted = deferred();
            const nextMutation = deferred();
            nativeOverride = async command => {
                if (command === 'fs_exists') return false;
                equal(command, 'fs_rename_batch', 'Keep the mutation boundary explicit');
                nextSubmitted.resolve(); await nextMutation.promise;
            };
            const nextMove = store.getState().pasteEntries(connectionId, [second.path], 'cut');
            await nextSubmitted.promise;
            store.getState().setClipboard([entry('new-selection', '/elsewhere')], connectionId, '/elsewhere', 'cut');
            const newerClipboard = store.getState().clipboard;
            nextMutation.resolve();
            equal(await nextMove, true, 'The earlier write still completes');
            equal(store.getState().clipboard, newerClipboard, 'Its outcome cannot consume a newer selection');
        } finally {
            nativeOverride = null;
        }
    });

    await run('two panes can acknowledge disjoint moves from one cut intent in either completion order', async () => {
        for (const completionOrder of [[0, 1], [1, 0]]) {
            const { store, connectionId } = fixture();
            const first = entry('first', '/source');
            const second = entry('second', '/source');
            store.getState().setPath(connectionId, '/left', 'left');
            store.getState().setPath(connectionId, '/right', 'right');
            store.getState().setClipboard([first, second], connectionId, '/source', 'cut');
            const originalIntentId = store.getState().clipboard?.intentId;
            const submitted = [deferred(), deferred()];
            const mutations = [deferred(), deferred()];
            let nextSubmission = 0;
            nativeOverride = async command => {
                if (command === 'fs_exists') return false;
                equal(command, 'fs_rename_batch', 'Both pane moves use the native batch acknowledgement');
                const index = nextSubmission++;
                submitted[index].resolve();
                await mutations[index].promise;
            };
            try {
                const moves = [
                    store.getState().pasteEntries(connectionId, [first.path], 'cut', undefined, 'left'),
                    store.getState().pasteEntries(connectionId, [second.path], 'cut', undefined, 'right'),
                ];
                await Promise.all(submitted.map(item => item.promise));
                mutations[completionOrder[0]].resolve();
                equal(await moves[completionOrder[0]], true, 'First acknowledgement succeeds');
                sameValues(store.getState().clipboard?.files, [completionOrder[0] === 0 ? second : first], 'Retain only the pending source');
                equal(store.getState().clipboard?.intentId, originalIntentId, 'Both operations still belong to the same user cut intent');
                mutations[completionOrder[1]].resolve();
                equal(await moves[completionOrder[1]], true, 'Concurrent acknowledgement succeeds');
                equal(store.getState().clipboard, null, 'Every acknowledged source leaves the original cut intent');
            } finally {
                nativeOverride = null;
            }
        }
    });

    await run('setting an identical clipboard selection creates a fresh intent protected from old outcomes', async () => {
        const { store, connectionId } = fixture();
        const source = entry('source', '/source');
        store.getState().setClipboard([source], connectionId, '/source', 'cut');
        const oldIntent = store.getState().clipboard;
        store.getState().setClipboard([source], connectionId, '/source', 'cut');
        const newIntent = store.getState().clipboard;
        equal(oldIntent?.intentId === newIntent?.intentId, false, 'A repeated user action is not the old intent');
        equal(acknowledgeMovedClipboard(newIntent, oldIntent, connectionId, [source.path]), newIntent, 'An old completion cannot consume an identical newer selection');
    });

    await run('a late successful paste cannot append old-folder entries or clear new-folder loading', async () => {
        const { store, connectionId } = fixture();
        const pane = filesStoreKey(connectionId, 'pane');
        const source = entry('source', '/source');
        store.getState().setPath(connectionId, '/destination', 'pane');
        store.getState().setClipboard([source], connectionId, '/source', 'cut');
        const submitted = deferred();
        const mutation = deferred();
        nativeOverride = async command => {
            if (command === 'fs_exists') return false;
            equal(command, 'fs_rename_batch', 'Await the requested move');
            submitted.resolve(); await mutation.promise;
        };
        try {
            const moved = store.getState().pasteEntries(connectionId, [source.path], 'cut', undefined, 'pane');
            await submitted.promise;
            const freshListing = [entry('new-folder-file', '/new')];
            store.getState().setPath(connectionId, '/new', 'pane');
            store.setState({ files: { [pane]: freshListing }, isLoading: { [pane]: true } });
            mutation.resolve();
            equal(await moved, true, 'Keep the actual successful move result');
            equal(store.getState().files[pane], freshListing, 'Do not pollute the newer folder');
            equal(store.getState().isLoading[pane], true, 'The newer navigation owns its loading state');
            equal(store.getState().clipboard, null, 'Actual movement still acknowledges the original cut intent');
        } finally {
            nativeOverride = null;
        }
    });

    await run('pasting a cut into its own folder leaves the original entry and clipboard intact', async () => {
        const { store, connectionId } = fixture();
        const source = entry('source', '/same');
        store.getState().setPath(connectionId, '/same');
        store.getState().setClipboard([source], connectionId, '/same', 'cut');
        const clipboard = store.getState().clipboard;
        const listing = [source];
        store.setState({ files: { [connectionId]: listing } });
        nativeOverride = async () => { throw new Error('A same-path no-op must not mutate'); };
        try {
            equal(await store.getState().pasteEntries(connectionId, [source.path], 'cut'), false, 'No mutation was acknowledged');
            equal(store.getState().clipboard, clipboard, 'Do not consume skipped cut entries');
            equal(store.getState().files[connectionId], listing, 'Do not remove the skipped source from its listing');
        } finally {
            nativeOverride = null;
        }
    });

    await run('a newer read of the same folder owns its listing and loading state', async () => {
        const { store, connectionId } = fixture();
        const source = entry('source', '/source');
        store.getState().setPath(connectionId, '/destination');
        const before = [entry('before', '/destination')];
        store.setState({ files: { [connectionId]: before } });
        const submitted = deferred();
        const mutation = deferred();
        let resolveListing!: (entries: FileEntry[]) => void;
        nativeOverride = async command => {
            if (command === 'fs_exists') return false;
            if (command === 'fs_list') return new Promise<FileEntry[]>(resolve => { resolveListing = resolve; });
            equal(command, 'fs_copy_batch', 'Await the requested copy');
            submitted.resolve(); await mutation.promise;
        };
        try {
            const copied = store.getState().pasteEntries(connectionId, [source.path], 'copy');
            await submitted.promise;
            const refreshed = store.getState().loadFiles(connectionId, '/destination', true);
            mutation.resolve();
            equal(await copied, true, 'The copy outcome is independent of the newer read');
            equal(store.getState().files[connectionId], before, 'Do not append an optimistic entry while the newer read owns the view');
            equal(store.getState().isLoading[connectionId], true, 'Do not clear a newer same-path request');
            resolveListing([entry('refreshed', '/destination')]);
            await refreshed;
            equal(store.getState().files[connectionId][0].name, 'refreshed', 'Use the actual newer listing result');
        } finally {
            nativeOverride = null;
        }
    });

    await run('a busy path rejects a whole paste batch before mutation and releases earlier admissions', async () => {
        const { store, connectionId } = fixture();
        store.getState().setPath(connectionId, '/destination');
        const sources = [entry('first', '/source'), entry('second', '/source')];
        store.getState().setClipboard(sources, connectionId, '/source', 'cut');
        const clipboard = store.getState().clipboard;
        const busy = acquireFileDestination(connectionId, '/destination/second');
        let mutations = 0;
        nativeOverride = async command => {
            if (command === 'fs_exists') return false;
            mutations += 1;
        };
        try {
            equal(await store.getState().pasteEntries(connectionId, sources.map(source => source.path), 'cut'), false, 'Do not partially submit an admitted batch');
            equal(mutations, 0, 'No batch may start if one destination is busy');
            equal(store.getState().clipboard, clipboard, 'Busy admission cannot acknowledge an unattempted cut');
            equal(store.getState().isLoading[connectionId], false, 'Busy admission must not leave the listing loading');
            acquireFileDestination(connectionId, '/destination/first').release();
            acquireFileDestination(connectionId, '/source/first').release();
        } finally {
            busy.release();
            nativeOverride = null;
        }
    });

    await run('cutting an active writer source is rejected before the move starts', async () => {
        const { store, connectionId } = fixture();
        store.getState().setPath(connectionId, '/destination');
        const busy = acquireFileDestination(connectionId, '/source/file');
        let mutations = 0;
        nativeOverride = async command => {
            if (command === 'fs_exists') return false;
            mutations += 1;
        };
        try {
            equal(await store.getState().pasteEntries(connectionId, ['/source/file'], 'cut'), false, 'An active writer must not be retargeted');
            equal(mutations, 0, 'Do not submit a rename of an active destination');
            acquireFileDestination(connectionId, '/destination/file').release();
        } finally {
            busy.release();
            nativeOverride = null;
        }
    });

    await run('ordinary uploads retain destination admission through the real native result', async () => {
        const { store, connectionId } = fixture();
        store.getState().setPath(connectionId, '/destination');
        const native = deferred();
        let calls = 0;
        let refreshReads = 0;
        nativeOverride = async (command, args) => {
            if (command === 'fs_list') {
                refreshReads++;
                return [entry('file', '/destination')];
            }
            equal(command, 'fs_transfer_file', 'Upload uses the shared staged native adapter');
            calls += 1;
            await native.promise;
            const request = args as Record<string, unknown>;
            return { version: 1, id: request.transferId, sourceConnectionId: request.sourceConnectionId, sourcePath: request.sourcePath,
                destinationConnectionId: request.destinationConnectionId, destinationPath: request.destinationPath,
                stagePath: '/destination/.zync-transfer-test.part', backupPath: '/destination/.zync-transfer-test.backup', backupExpected: false,
                phase: 'completed', createdAt: 1, transferred: 1, total: 1, destinationUnchanged: false, warning: null, error: null };
        };
        try {
            await store.getState().uploadFiles(connectionId, ['/source/file']);
            equal(store.getState().transfers[0].status, 'pending', 'Starting an upload must not claim completion');
            await store.getState().uploadFiles(connectionId, ['/other/file']);
            equal(calls, 1, 'A second upload cannot overwrite an active destination');
            equal(store.getState().transfers[1].status, 'failed', 'Retain the rejected upload receipt');
            equal(store.getState().transfers[1].error?.startsWith('Destination is busy:'), true, 'Explain why the upload was rejected');
            equal(refreshReads, 0, 'A rejected admission does not refresh an unchanged destination');
            native.resolve();
            for (let i = 0; i < 5; i += 1) await Promise.resolve();
            equal(store.getState().transfers[0].status, 'completed', 'Record the actual first upload completion');
            equal(refreshReads, 1, 'An accepted native receipt refreshes without waiting for an event');
            acquireFileDestination(connectionId, '/destination/file').release();
        } finally {
            native.resolve();
            nativeOverride = null;
        }
    });

    await run('ordinary mutations cannot rename, delete or create over an active destination', async () => {
        const { store, connectionId } = fixture();
        store.getState().setPath(connectionId, '/destination');
        store.setState({ refreshFiles: async () => {} });
        const busy = acquireFileDestination(connectionId, '/destination/file');
        let mutations = 0;
        nativeOverride = async () => { mutations += 1; };
        try {
            await store.getState().createFolder(connectionId, 'file');
            await store.getState().renameEntry(connectionId, 'file', 'other');
            await store.getState().renameEntry(connectionId, 'other', 'file');
            await store.getState().deleteEntries(connectionId, ['/destination/file']);
            equal(mutations, 0, 'Busy guards must precede each native mutation');
            acquireFileDestination(connectionId, '/destination/other').release();
        } finally {
            busy.release();
            nativeOverride = null;
        }
    });

    await run('a Windows case-only rename is one admitted mutation, not competing self-leases', async () => {
        const { store, connectionId } = fixture();
        store.getState().setPath(connectionId, 'C:/destination');
        store.setState({ refreshFiles: async () => {} });
        let mutations = 0;
        nativeOverride = async command => { equal(command, 'fs_rename', 'Keep the original rename operation'); mutations += 1; };
        try {
            await store.getState().renameEntry(connectionId, 'File', 'file');
            equal(mutations, 1, 'A single rename may own both of its paths');
            acquireFileDestination(connectionId, 'C:/destination/file').release();
        } finally { nativeOverride = null; }
    });
} finally {
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor);
    else Reflect.deleteProperty(globalThis, 'window');
}
