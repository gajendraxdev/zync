import { StateCreator } from 'zustand';
import type { AppStore } from './useAppStore';
import { notify } from '../features/notifications';
import type { FileEntry } from '../components/file-manager/types';
import { expandTildeWithHome } from '../components/layout/tabDock/openHerePaths';
import { parentFilePath } from '../components/file-manager/filePathNav';
import { FILE_RECENT_LIMIT_MAX } from '../components/file-manager/fileChrome';

// @ts-ignore
const ipc = window.ipcRenderer;
const filesLoadGeneration = new Map<string, number>();
const recentPathsGeneration = new Map<string, number>();

/**
 * Splits a filename into base and extension, handling dotfiles correctly.
 * .env -> base: .env, ext: ""
 * test.txt -> base: test, ext: .txt
 */
/** Listing/cwd key. Overlay Files uses `connectionId`; split panes use `connectionId::instanceId`. */
export function filesStoreKey(connectionId: string, instanceId?: string | null): string {
    const id = (instanceId || '').trim();
    return id ? `${connectionId}::${id}` : connectionId;
}

export function splitFileName(name: string): { base: string; ext: string } {
    // If it starts with a dot and has no other dots, it's a hidden file like .env
    if (name.startsWith('.') && name.indexOf('.', 1) === -1) {
        return { base: name, ext: '' };
    }
    const lastDot = name.lastIndexOf('.');
    // If no dot, or dot is at the beginning (but we handled the single dot case above)
    if (lastDot === -1 || lastDot === 0) {
        return { base: name, ext: '' };
    }
    return {
        base: name.slice(0, lastDot),
        ext: name.slice(lastDot)
    };
}

export interface FileSystemState {
    files: Record<string, FileEntry[]>; // keyed by connectionId
    currentPath: Record<string, string>; // keyed by connectionId
    history: Record<string, string[]>; // keyed by connectionId
    historyIndex: Record<string, number>; // keyed by connectionId
    recentPaths: Record<string, string[]>;
    isLoading: Record<string, boolean>; // keyed by connectionId
    error: Record<string, string | null>; // keyed by connectionId
    clipboard: {
        files: FileEntry[];
        sourceConnectionId: string;
        sourcePath: string; // parent path
        sourceInstanceId?: string;
        op: 'copy' | 'cut';
    } | null;
}

export interface FileSystemActions {
    setPath: (connectionId: string, path: string, instanceId?: string) => void;
    loadFiles: (connectionId: string, path?: string, skipHistory?: boolean, silent?: boolean, instanceId?: string) => Promise<void>;
    refreshFiles: (connectionId: string, instanceId?: string) => Promise<void>;
    createFolder: (connectionId: string, name: string, instanceId?: string) => Promise<void>;
    renameEntry: (connectionId: string, oldName: string, newName: string, instanceId?: string) => Promise<void>;
    deleteEntries: (connectionId: string, paths: string[], instanceId?: string) => Promise<void>;
    uploadFiles: (connectionId: string, localPaths: string[], instanceId?: string) => Promise<void>;
    downloadFiles: (connectionId: string, remotePaths: string[]) => Promise<void>;
    navigateUp: (connectionId: string, instanceId?: string) => void;
    navigateBack: (connectionId: string, instanceId?: string) => void;
    navigateForward: (connectionId: string, instanceId?: string) => void;
    navigateHistoryTo: (connectionId: string, index: number, instanceId?: string) => void;
    setClipboard: (files: FileEntry[], sourceConnectionId: string, sourcePath: string, op: 'copy' | 'cut', sourceInstanceId?: string) => void;
    clearClipboard: () => void;
    clearRecentPaths: (connectionId: string) => void;
    pasteEntries: (connectionId: string, sources: string[], op: 'copy' | 'cut', destinationDirectory?: string, instanceId?: string) => Promise<void>;
    checkPathExists: (connectionId: string, path: string) => Promise<boolean>;
    copyFilesListing: (connectionId: string, fromInstanceId: string | null | undefined, toInstanceId?: string | null) => void;
}

export type FileSystemSlice = FileSystemState & FileSystemActions;

export const createFileSystemSlice: StateCreator<AppStore, [], [], FileSystemSlice> = (set, get) => ({
    files: {},
    currentPath: {},
    history: {},
    historyIndex: {},
    recentPaths: {},
    isLoading: {},
    error: {},
    clipboard: null,

    setClipboard: (files, sourceConnectionId, sourcePath, op, sourceInstanceId) => {
        set({ clipboard: { files, sourceConnectionId, sourcePath, sourceInstanceId, op } });
    },

    clearClipboard: () => {
        set({ clipboard: null });
    },

    clearRecentPaths: (connectionId) => {
        recentPathsGeneration.set(connectionId, (recentPathsGeneration.get(connectionId) || 0) + 1);
        set((state) => ({
            recentPaths: { ...state.recentPaths, [connectionId]: [] },
        }));
    },

    copyFilesListing: (connectionId, fromInstanceId, toInstanceId) => {
        const fromKey = filesStoreKey(connectionId, fromInstanceId);
        const toKey = filesStoreKey(connectionId, toInstanceId);
        if (fromKey === toKey) return;
        set((state) => ({
            files: { ...state.files, [toKey]: state.files[fromKey] ?? [] },
            currentPath: { ...state.currentPath, [toKey]: state.currentPath[fromKey] ?? '' },
            history: { ...state.history, [toKey]: [...(state.history[fromKey] ?? [])] },
            historyIndex: { ...state.historyIndex, [toKey]: state.historyIndex[fromKey] ?? 0 },
            error: { ...state.error, [toKey]: state.error[fromKey] ?? null },
            isLoading: { ...state.isLoading, [toKey]: false },
        }));
    },

    setPath: (connectionId, path, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        set(state => ({
            currentPath: { ...state.currentPath, [key]: path }
        }));
    },

    loadFiles: async (connectionId, path, skipHistory = false, silent = false, instanceId) => {
        const state = get();
        const key = filesStoreKey(connectionId, instanceId);
        let targetPath = (path !== undefined ? path : state.currentPath[key] || '').trim();
        if (!targetPath) return;
        const recentGen = recentPathsGeneration.get(connectionId) || 0;
        const loadGen = (filesLoadGeneration.get(key) || 0) + 1;
        filesLoadGeneration.set(key, loadGen);
        if (targetPath === '~' || targetPath.startsWith('~/')) {
            const conn = get().connections.find((c) => c.id === connectionId);
            let home = (conn?.homePath ?? '').trim();
            if (!home || home === '/' || home === '~') {
                try {
                    const cwd = await ipc.invoke('fs_cwd', { connectionId });
                    if (filesLoadGeneration.get(key) !== loadGen) return;
                    if (typeof cwd === 'string') home = cwd.trim();
                } catch {
                    if (filesLoadGeneration.get(key) !== loadGen) return;
                    home = '';
                }
            }
            if (filesLoadGeneration.get(key) !== loadGen) return;
            const expanded = expandTildeWithHome(targetPath, home);
            if (!expanded || expanded === '~' || expanded.startsWith('~/')) return;
            targetPath = expanded;
        }

        // History Logic
        if (!skipHistory && targetPath !== state.currentPath[key]) {
            const currentHistory = state.history[key] || [];
            const currentIndex = state.historyIndex[key] || 0;

            // If we are at the end of history, push new path
            // If we are in middle, truncate future and push
            const newHistory = [...currentHistory.slice(0, currentIndex + 1), targetPath];

            // If history is empty, initialize it with BOTH previous path (if exists) and new path?
            // Or just make sure initial path is there.
            if (newHistory.length === 1 && state.currentPath[key]) {
                // First navigation: ensure start path is in history at index 0
                newHistory.unshift(state.currentPath[key]);
            }

            set(state => ({
                history: { ...state.history, [key]: newHistory },
                historyIndex: { ...state.historyIndex, [key]: newHistory.length - 1 }
            }));
        }

        if (!silent) {
            set(state => ({
                isLoading: { ...state.isLoading, [key]: true },
                error: { ...state.error, [key]: null }
            }));
        } else {
            set(state => ({
                error: { ...state.error, [key]: null }
            }));
        }

        try {
            const entries = await ipc.invoke('fs_list', { connectionId, path: targetPath });

            const mappedEntries: FileEntry[] = entries.map((e: any) => ({
                name: e.name,
                type: e.type,
                size: e.size,
                lastModified: e.lastModified,
                permissions: e.permissions,
                path: e.path,
                owner: typeof e.owner === 'string' ? e.owner : '',
                group: typeof e.group === 'string' ? e.group : '',
            }));

            if (filesLoadGeneration.get(key) !== loadGen) return;
            const skipRecent = (recentPathsGeneration.get(connectionId) || 0) !== recentGen;
            set(state => {
                const prevRecent = state.recentPaths[connectionId] || [];
                const recentUnchanged = skipRecent || prevRecent[0] === targetPath;
                const nextRecent = recentUnchanged
                    ? prevRecent
                    : [targetPath, ...prevRecent.filter((p) => p !== targetPath)].slice(0, FILE_RECENT_LIMIT_MAX);
                const currentHist = state.history[key];
                const historyPatch = (!currentHist || currentHist.length === 0)
                    ? {
                        history: { ...state.history, [key]: [targetPath] },
                        historyIndex: { ...state.historyIndex, [key]: 0 },
                    }
                    : {};
                return {
                    files: { ...state.files, [key]: mappedEntries },
                    currentPath: { ...state.currentPath, [key]: targetPath },
                    isLoading: { ...state.isLoading, [key]: false },
                    recentPaths: recentUnchanged
                        ? state.recentPaths
                        : { ...state.recentPaths, [connectionId]: nextRecent },
                    ...historyPatch,
                };
            });

        } catch (error: any) {
            if (filesLoadGeneration.get(key) !== loadGen) return;
            console.error('Failed to load files:', error);
            const osError = error.message || String(error);

            if (osError.includes('DISCONNECTED:')) {
                set(state => ({
                    isLoading: { ...state.isLoading, [key]: false },
                    error: { ...state.error, [key]: 'DISCONNECTED' }
                }));
                return;
            }

            set(state => ({
                isLoading: { ...state.isLoading, [key]: false },
                error: { ...state.error, [key]: osError }
            }));

            // Handle "No such file" (Directory deleted?)
            if (osError.includes('No such file') || osError.includes('does not exist')) {
                if (targetPath === '~' || targetPath.startsWith('~/')) return;
                // If we are not at root, try moving up
                if (targetPath !== '/' && targetPath !== '') {
                    const parent = targetPath.substring(0, targetPath.lastIndexOf('/')) || '/';
                    console.log(`Path ${targetPath} not found, navigating up to ${parent}`);
                    // Update path state immediately to prevent loops
                    set(state => ({
                        currentPath: { ...state.currentPath, [key]: parent }
                    }));
                    // Try loading parent
                    get().loadFiles(connectionId, parent, false, false, instanceId);
                    return;
                }
            }

            if (osError.includes('Connection not found')) {
                get().disconnect(connectionId);
            }
        }
    },

    refreshFiles: async (connectionId, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        const path = get().currentPath[key];
        if (path) {
            await get().loadFiles(connectionId, path, true, true, instanceId);
        }
    },

    createFolder: async (connectionId, name, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        const path = get().currentPath[key];
        const fullPath = path === '/' ? `/${name}` : `${path}/${name}`;

        set(state => ({ isLoading: { ...state.isLoading, [key]: true } }));
        try {
            await ipc.invoke('fs_mkdir', { connectionId, path: fullPath });
            get().setLastAction(`Created folder "${name}"`, 'success');
            await get().refreshFiles(connectionId, instanceId);
        } catch (error: any) {
            const msg = error.message || String(error);
            if (msg.includes('DISCONNECTED:')) {
                set(state => ({ error: { ...state.error, [key]: 'DISCONNECTED' } }));
                set(state => ({ isLoading: { ...state.isLoading, [key]: false } }));
                return;
            } else {
                notify.error(`Failed to create folder: ${msg}`, { source: 'files' });
            }
            set(state => ({ isLoading: { ...state.isLoading, [key]: false } }));
        }
    },

    renameEntry: async (connectionId, oldName, newName, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        const path = get().currentPath[key];
        const oldPath = path === '/' ? `/${oldName}` : `${path}/${oldName}`;
        const newPath = path === '/' ? `/${newName}` : `${path}/${newName}`;

        try {
            await ipc.invoke('fs_rename', { connectionId, oldPath, newPath });
            get().setLastAction(`Renamed to "${newName}"`, 'success');
            await get().refreshFiles(connectionId, instanceId);
        } catch (error: any) {
            const msg = error.message || String(error);
            if (msg.includes('DISCONNECTED:')) {
                set(state => ({ error: { ...state.error, [key]: 'DISCONNECTED' } }));
                return;
            } else {
                notify.error(`Failed to rename: ${msg}`, { source: 'files' });
            }
        }
    },

    deleteEntries: async (connectionId, paths, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        // Optimistic update: Remove from state immediately
        const previousFiles = get().files[key] || [];
        set(state => {
            const currentFiles = state.files[key] || [];
            const newFiles = currentFiles.filter(f => !paths.includes(f.path));
            return { files: { ...state.files, [key]: newFiles } };
        });

        try {
            await ipc.invoke('fs_delete_batch', { connectionId, paths });
            get().setLastAction(`Deleted ${paths.length} item(s)`, 'success');
        } catch (error: any) {
            const failedPaths: string[] = error.failed_paths || [];
            const msg = error.message || String(error);
            
            // Targeted rollback: Only restore paths that actually failed
            if (failedPaths.length > 0) {
                const successfullyDeleted = paths.filter(p => !failedPaths.includes(p));
                set(state => {
                    const finalFiles = previousFiles.filter(f => !successfullyDeleted.includes(f.path));
                    return { files: { ...state.files, [key]: finalFiles } };
                });
            } else {
                // Full rollback if error is opaque or all failed
                set(state => ({
                    files: { ...state.files, [key]: previousFiles }
                }));
            }

            if (msg.includes('DISCONNECTED:')) {
                set(state => ({ error: { ...state.error, [key]: 'DISCONNECTED' } }));
                return;
            } else {
                notify.error(`Delete failed: ${msg}`, { source: 'files' });
            }
            // Final safety refresh
            await get().refreshFiles(connectionId, instanceId);
        }
    },

    uploadFiles: async (connectionId, localPaths, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        const path = get().currentPath[key];
        // Do not set isLoading to true here, as we want "background" upload

        // get().showToast('info', `Starting background upload of ${localPaths.length} items...`);
        get().setLastAction(`Starting upload of ${localPaths.length} items...`, 'info');

        try {
            // We need to access the store to add transfer
            // Since we are inside the store creator, we can use `get()` to access other slices if they are merged?
            // Yes, `get()` returns `AppStore`.
            const addTransfer = get().addTransfer;

            for (const localPath of localPaths) {
                // @ts-ignore
                const fileName = localPath.split(/[/\\]/).pop();
                const remotePath = path === '/' ? `/${fileName}` : `${path}/${fileName}`;

                const transferId = addTransfer({
                    sourceConnectionId: 'local',
                    sourcePath: localPath,
                    destinationConnectionId: connectionId,
                    destinationPath: remotePath
                });

                // Call backend asynchronously (fire and forget from frontend perspective)
                // The backend will emit events to update status
                ipc.invoke('sftp_put', { // Fix: Command name is sftp_put for background upload
                    id: connectionId,
                    localPath,
                    remotePath,
                    transferId // Pass transferId to backend
                }).catch((err: any) => {
                    console.error('Upload start failed:', err);
                    get().failTransfer(transferId, err.message || String(err));
                    notify.error(`Failed to start upload: ${err.message || err}`, { source: 'files' });
                });
            }
        } catch (error: any) {
            notify.error(`Upload initialization failed: ${error.message || error}`, { source: 'files' });
        }
    },

    downloadFiles: async (_connectionId, _remotePaths) => {
        // Implementation pending
        console.log('Download not fully implemented in store slice yet');
    },

    pasteEntries: async (connectionId, sources, op, destinationDirectory, instanceId) => {
        const state = get();
        const key = filesStoreKey(connectionId, instanceId);
        const currentPath = destinationDirectory !== undefined ? destinationDirectory : (state.currentPath[key] || '/');

        set(state => ({ isLoading: { ...state.isLoading, [key]: true } }));

        try {
            // Processing list for optimistic updates
            const newEntries: FileEntry[] = [];
            const pathsToRemoveFromSource: string[] = [];
            const successfulSources: string[] = [];

            const sourceConnectionId = get().clipboard?.sourceConnectionId || connectionId;
            const isSourceWindows = sourceConnectionId === 'local' && window.electronUtils?.platform === 'win32';
            const isDestWindows = connectionId === 'local' && window.electronUtils?.platform === 'win32';
            const isWindowsContext = isSourceWindows || isDestWindows;

            // Highly strict normalization function to insulate equality checks from Windows backslashes
            const normalizePath = (p: string) => isWindowsContext ? p.replace(/\\/g, '/') : p;
            const normCurrentPath = normalizePath(currentPath);

            for (const rawSource of sources) {
                const source = normalizePath(rawSource);
                const originalName = source.split('/').pop() || 'unknown';
                
                // Now safely construct destPath with standard forward slashes
                let destPath = normCurrentPath.endsWith('/') ? `${normCurrentPath}${originalName}` : `${normCurrentPath}/${originalName}`;

                // Handle Collision (Auto-Rename)
                // If cut and same path, skip
                if (op === 'cut' && source === destPath) continue;

                // Collision Detection Loop
                if (source === destPath || await get().checkPathExists(connectionId, destPath)) {
                    const { base, ext } = splitFileName(originalName);
                    let counter = 1;

                    while (true) {
                        const newName = `${base} (${counter})${ext}`;
                        destPath = normCurrentPath === '/' ? `/${newName}` : `${normCurrentPath}/${newName}`;

                        // Check local optimistic list too to avoid collisions within the batch
                        const collisionInBatch = newEntries.some(e => normalizePath(e.path) === destPath);
                        if (source !== destPath && !collisionInBatch && !(await get().checkPathExists(connectionId, destPath))) {
                            break;
                        }
                        counter++;
                        if (counter > 100) throw new Error('Too many duplicate files');
                    }
                }

                // Prepare Optimistic Entry
                const newName = destPath.split('/').pop() || 'unknown';

                // Map to FileEntry type ('d' | '-' | 'l')
                // Default to file ('-') if unknown
                let entryType: '-' | 'd' | 'l' = '-';
                let entrySize = 0;

                if (state.clipboard && state.clipboard.files) {
                    const clipEntry = state.clipboard.files.find(f => normalizePath(f.path) === source);
                    if (clipEntry) {
                        entryType = clipEntry.type;
                        entrySize = clipEntry.size;
                    } else if (!source.includes('.')) {
                        // Fallback guess: no extension -> likely folder? Not reliable but acceptable for optimistic
                    }
                } else {
                    // If we are pasting but clipboard is null (how?), default to file
                    if (!source.includes('.')) entryType = 'd';
                }

                const newEntry: FileEntry = {
                    name: newName,
                    path: destPath,
                    type: entryType,
                    size: entrySize,
                    lastModified: Date.now() / 1000,
                    permissions: 'rwxr-xr-x', // Dummy permissions
                    owner: '',
                    group: '',
                };

                newEntries.push(newEntry);
                successfulSources.push(source);
                if (op === 'cut') {
                    pathsToRemoveFromSource.push(source);
                }
            }

            // Fire Backend (Batch Optimized)
            if (newEntries.length > 0) {
                const operations = newEntries.map((e, idx) => ({
                    from: successfulSources[idx],
                    to: e.path
                }));

                const command = op === 'copy' ? 'fs_copy_batch' : 'fs_rename_batch';
                await ipc.invoke(command, { connectionId, operations });
            }

            const sourceKey = filesStoreKey(
                state.clipboard?.sourceConnectionId || connectionId,
                state.clipboard?.sourceInstanceId,
            );
            const normalizedSourcesSet = new Set(sources.map(s => normalizePath(s)));

            set(state => {
                const destFiles = state.files[key] || [];
                const destAfterCut = (op === 'cut' && sourceKey === key)
                    ? destFiles.filter(f => !normalizedSourcesSet.has(normalizePath(f.path)))
                    : destFiles;
                const filteredNewEntries = newEntries.filter(entry => {
                    const entryParent = entry.path.substring(0, entry.path.lastIndexOf('/')) || '/';
                    return normalizePath(entryParent) === normCurrentPath;
                });
                const nextFiles = {
                    ...state.files,
                    [key]: destAfterCut.concat(filteredNewEntries),
                };
                if (op === 'cut' && sourceKey !== key && state.files[sourceKey]) {
                    nextFiles[sourceKey] = state.files[sourceKey].filter(
                        f => !pathsToRemoveFromSource.map(p => normalizePath(p)).includes(normalizePath(f.path)),
                    );
                }
                return {
                    isLoading: { ...state.isLoading, [key]: false },
                    files: nextFiles,
                };
            });

            get().setLastAction(`${op === 'copy' ? 'Copying' : 'Moving'} ${sources.length} item(s)...`, 'info');
        } catch (error: any) {
            const msg = error.message || String(error);
            if (msg.includes('DISCONNECTED:')) {
                set(state => ({ error: { ...state.error, [key]: 'DISCONNECTED' } }));
                set(state => ({ isLoading: { ...state.isLoading, [key]: false } }));
                return;
            } else {
                notify.error(`Paste failed: ${msg}`, { source: 'files' });
            }
            set(state => ({ isLoading: { ...state.isLoading, [key]: false } }));
        }
    },

    navigateUp: (connectionId, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        const path = get().currentPath[key];
        if (!path) return;
        const parentPath = parentFilePath(path);
        if (!parentPath) return;
        get().loadFiles(connectionId, parentPath, false, false, instanceId);
    },

    navigateBack: (connectionId, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        const state = get();
        const history = state.history[key] || [];
        const index = state.historyIndex[key] || 0;

        if (index > 0) {
            const newIndex = index - 1;
            const prevPath = history[newIndex];

            set(state => ({
                historyIndex: { ...state.historyIndex, [key]: newIndex }
            }));

            get().loadFiles(connectionId, prevPath, true, false, instanceId);
        }
    },

    navigateForward: (connectionId, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        const state = get();
        const history = state.history[key] || [];
        const index = state.historyIndex[key] || 0;

        if (index < history.length - 1) {
            const newIndex = index + 1;
            const nextPath = history[newIndex];

            set(state => ({
                historyIndex: { ...state.historyIndex, [key]: newIndex }
            }));

            get().loadFiles(connectionId, nextPath, true, false, instanceId);
        }
    },

    navigateHistoryTo: (connectionId, index, instanceId) => {
        const key = filesStoreKey(connectionId, instanceId);
        const history = get().history[key] || [];
        if (index < 0 || index >= history.length) return;
        set((state) => ({
            historyIndex: { ...state.historyIndex, [key]: index },
        }));
        get().loadFiles(connectionId, history[index], true, false, instanceId);
    },

    checkPathExists: async (connectionId, path) => {
        try {
            return await ipc.invoke('fs_exists', { connectionId, path });
        } catch (error) {
            console.error('Failed to check path existence:', error);
            return false;
        }
    }
});
