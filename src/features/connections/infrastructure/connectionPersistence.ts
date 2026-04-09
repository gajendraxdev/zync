import type { Connection, Folder } from '../../../store/connectionSlice';

export interface PersistedConnectionPayload {
    connections: Array<Omit<Connection, 'status'>>;
    folders: Folder[];
}

export const toPersistedConnections = (connections: Connection[]): Array<Omit<Connection, 'status'>> =>
    connections.map(({ status, ...connection }) => connection);

export const loadConnectionsIpc = async (): Promise<any> =>
    window.ipcRenderer.invoke('connections:get');

export const saveConnectionsIpc = async (
    connections: Connection[],
    folders: Folder[],
): Promise<void> => {
    const payload: PersistedConnectionPayload = {
        connections: toPersistedConnections(connections),
        folders,
    };
    await window.ipcRenderer.invoke('connections:save', payload);
};
