import type { Connection } from './types.js';
import { normalizeFolderPath, normalizePort, normalizeTags } from './normalization.js';

export type ConnectionAuthMode = 'password' | 'key';

export type ConnectionFormDraft = Partial<Connection>;

interface ToBackendConfig {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    auth_method: { type: 'Password'; password: string } | { type: 'PrivateKey'; key_path: string; passphrase: null };
    jump_host: ToBackendConfig | null;
}

type ConfigCandidate = Connection | ConnectionFormDraft;

const toBackendConfig = (
    candidate: ConfigCandidate,
    formDraft: ConnectionFormDraft,
    authMode: ConnectionAuthMode,
    password?: string,
    keyPath?: string,
): ToBackendConfig => {
    const isForm = candidate === formDraft;

    let auth_method: ToBackendConfig['auth_method'];
    if (isForm) {
        if (authMode === 'password') {
            auth_method = { type: 'Password', password: password || '' };
        } else {
            auth_method = { type: 'PrivateKey', key_path: keyPath || '', passphrase: null };
        }
    } else if (candidate.password !== undefined) {
        auth_method = { type: 'Password', password: candidate.password };
    } else {
        auth_method = { type: 'PrivateKey', key_path: candidate.privateKeyPath || '', passphrase: null };
    }

    return {
        id: candidate.id || 'test-temp',
        name: candidate.name || 'Test Connection',
        host: candidate.host || '',
        port: normalizePort(candidate.port),
        username: candidate.username || '',
        auth_method,
        jump_host: null,
    };
};

const buildJumpChain = (
    connections: Connection[],
    jumpServerId: string | undefined,
    visited: Set<string> = new Set(),
): ToBackendConfig | null => {
    if (!jumpServerId || visited.has(jumpServerId)) return null;
    visited.add(jumpServerId);

    const jumpConnection = connections.find((connection) => connection.id === jumpServerId);
    if (!jumpConnection) return null;

    return {
        ...toBackendConfig(jumpConnection, {} as ConnectionFormDraft, 'password'),
        jump_host: buildJumpChain(connections, jumpConnection.jumpServerId, new Set(visited)),
    };
};

export const buildConnectionSavePayload = ({
    formData,
    authMethod,
    editingConnectionId,
    connections,
}: {
    formData: ConnectionFormDraft;
    authMethod: ConnectionAuthMode;
    editingConnectionId: string | null;
    connections: Connection[];
}): Connection => ({
    id: editingConnectionId || Math.random().toString(36).substr(2, 9),
    name: formData.name || formData.host || '',
    host: formData.host!,
    username: formData.username!,
    port: normalizePort(formData.port),
    password: authMethod === 'password' ? formData.password : undefined,
    privateKeyPath: authMethod === 'key' ? formData.privateKeyPath : undefined,
    status: editingConnectionId ? (connections.find((c) => c.id === editingConnectionId)?.status || 'disconnected') : 'disconnected',
    jumpServerId: formData.jumpServerId,
    icon: formData.icon,
    theme: formData.theme,
    folder: normalizeFolderPath(formData.folder || ''),
    tags: normalizeTags(formData.tags || []),
});

export const buildConnectionTestPayload = ({
    formData,
    authMethod,
    connections,
}: {
    formData: ConnectionFormDraft;
    authMethod: ConnectionAuthMode;
    connections: Connection[];
}): ToBackendConfig => {
    return {
        ...toBackendConfig(formData, formData, authMethod, formData.password, formData.privateKeyPath),
        jump_host: buildJumpChain(connections, formData.jumpServerId),
    };
};
