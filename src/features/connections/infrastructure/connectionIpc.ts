export interface AuthMethodPassword {
    type: 'Password';
    password: string;
}

export interface AuthMethodPrivateKey {
    type: 'PrivateKey';
    key_path: string;
    passphrase: string | null;
}

export type AuthMethodPayload = AuthMethodPassword | AuthMethodPrivateKey;

export interface ConnectionConfigPayload {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    auth_method: AuthMethodPayload;
    jump_host: ConnectionConfigPayload | null;
}

export interface ConnectResponsePayload {
    success: boolean;
    message: string;
    term_id?: string | null;
    detected_os?: string | null;
}

export const testConnectionIpc = async (config: ConnectionConfigPayload): Promise<string> =>
    window.ipcRenderer.invoke('ssh:test', config);

export const importSshConfigIpc = async (): Promise<any[]> =>
    window.ipcRenderer.invoke('ssh:importConfig');

export const internalizeImportedConnectionsIpc = async (connections: any[]): Promise<any[]> =>
    window.ipcRenderer.invoke('ssh:internalize-connections', connections);

export const connectIpc = async (config: ConnectionConfigPayload): Promise<ConnectResponsePayload> =>
    window.ipcRenderer.invoke('ssh:connect', config);

export const disconnectIpc = async (connectionId: string): Promise<void> =>
    window.ipcRenderer.invoke('ssh:disconnect', connectionId);

export const getRemoteCwdIpc = async (connectionId: string): Promise<string> =>
    window.ipcRenderer.invoke('fs:cwd', connectionId);
