import type { Connection } from './types.js';

export interface ConnectAuthMethodPassword {
    type: 'Password';
    password: string;
}

export interface ConnectAuthMethodPrivateKey {
    type: 'PrivateKey';
    key_path: string;
    passphrase: string | null;
}

/** Sent when the connection uses a vault credential. Backend resolves item_id → secret. */
export interface ConnectAuthMethodVaultRef {
    type: 'VaultRef';
    item_id: string;
    credential_id?: string;
}

export type ConnectAuthMethod =
    | ConnectAuthMethodPassword
    | ConnectAuthMethodPrivateKey
    | ConnectAuthMethodVaultRef;

export interface ConnectConfig {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    auth_method: ConnectAuthMethod;
    jump_host: ConnectConfig | null;
}

type ConnectionWithLegacyAuthFields = Connection & {
    private_key_path?: string | null;
    auth_ref?: Connection['authRef'] | null;
};

const normalizeOptionalText = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const getConnectionAuthRef = (connection: ConnectionWithLegacyAuthFields): Connection['authRef'] | undefined =>
    connection.authRef ?? connection.auth_ref ?? undefined;

const getConnectionPrivateKeyPath = (connection: ConnectionWithLegacyAuthFields): string | undefined =>
    normalizeOptionalText(connection.privateKeyPath) ?? normalizeOptionalText(connection.private_key_path);

const getConnectionPassword = (connection: ConnectionWithLegacyAuthFields): string | undefined =>
    typeof connection.password === 'string' && connection.password.length > 0
        ? connection.password
        : undefined;

const buildAuthMethod = (connection: ConnectionWithLegacyAuthFields): ConnectAuthMethod | null => {
    const authRef = getConnectionAuthRef(connection);
    if (authRef?.itemId) {
        return {
            type: 'VaultRef',
            item_id: authRef.itemId,
            credential_id: authRef.credentialId,
        };
    }

    const privateKeyPath = getConnectionPrivateKeyPath(connection);
    if (privateKeyPath) {
        return {
            type: 'PrivateKey',
            key_path: privateKeyPath,
            passphrase: getConnectionPassword(connection) ?? null,
        };
    }

    const password = getConnectionPassword(connection);
    return password ? { type: 'Password', password } : null;
};

export const buildConnectConfig = (
    connections: Connection[],
    connectionId: string,
    visited: Set<string> = new Set(),
): ConnectConfig | null => {
    if (visited.has(connectionId)) return null;
    visited.add(connectionId);

    if (visited.size > 10) return null;

    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) return null;

    const auth_method = buildAuthMethod(connection);
    if (!auth_method) return null;

    const config: ConnectConfig = {
        id: connection.id,
        name: connection.name,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        auth_method,
        jump_host: null,
    };

    if (connection.jumpServerId) {
        const jumpConfig = buildConnectConfig(connections, connection.jumpServerId, new Set(visited));
        if (!jumpConfig) return null;
        config.jump_host = jumpConfig;
    }

    return config;
};
