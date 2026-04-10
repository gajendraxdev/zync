import { normalizeFolderPath } from './normalization.js';
import type { Connection, Folder } from './types.js';

export const isFolderOrDescendant = (ancestor: string, target: string): boolean => {
    const a = normalizeFolderPath(ancestor);
    const t = normalizeFolderPath(target);
    if (!a || !t) return false;
    if (a === '/') return t === a || (t.startsWith('/') && t !== '/');
    return t === a || t.startsWith(`${a}/`);
};

export const remapFolderPath = (path: string, oldBase: string, newBase: string): string => {
    const source = normalizeFolderPath(path) || path || '';
    const from = normalizeFolderPath(oldBase) || oldBase || '';
    const to = normalizeFolderPath(newBase) || newBase || '';
    if (!source || !from || !to) return path || '';
    if (!isFolderOrDescendant(from, source)) return path || '';
    if (source === from) return to;

    const remainder = source.slice(from.length).replace(/^\/+/, '');
    if (to === '/') return remainder ? `/${remainder}` : '/';
    return `${to}/${remainder}`;
};

// --- Current-slice parity helpers (exact-match behavior, no normalization side effects) ---
export const addFolderExact = (folders: Folder[], name: string, tags?: string[]): Folder[] => {
    if (folders.some((f) => f.name === name)) return folders;
    return [...folders, { name, tags }];
};

export const deleteFolderExact = (folders: Folder[], name: string): Folder[] =>
    folders.filter((f) => f.name !== name);

export const renameFolderExact = (folders: Folder[], oldName: string, newName: string, newTags?: string[]): Folder[] =>
    folders.map((f) => (f.name === oldName ? { ...f, name: newName, tags: newTags || f.tags } : f));

export const updateConnectionFolderExact = (
    connections: Connection[],
    connectionId: string,
    folderName: string,
): Connection[] => connections.map((c) => (c.id === connectionId ? { ...c, folder: folderName } : c));

export const renameConnectionFolderExact = (
    connections: Connection[],
    oldName: string,
    newName: string,
): Connection[] => connections.map((c) => (c.folder === oldName ? { ...c, folder: newName } : c));
