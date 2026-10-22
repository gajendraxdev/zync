import { create } from 'zustand';
import type { ConnectConfig } from '../domain/connectionConfig.js';
import type { NetworkPreference } from '../domain/types.js';
import { formatConnectionEndpoint } from '../domain/connectionDisplay.js';
import { listNetworkInterfacesIpc as listNetworkInterfaces, getNetworkPreferenceIpc as getNetworkPreference,
    saveNetworkPreferenceIpc as saveNetworkPreference } from '../infrastructure/connectionIpc.js';

export type { NetworkPreference, NetworkInterface } from '../domain/types.js';
export { listNetworkInterfaces, getNetworkPreference, saveNetworkPreference };
export interface NetworkChoice { interfaceId?: string }
interface NetworkPrompt { id: number; ownerId: string; name: string; resolve: (choice: NetworkChoice | null) => void }

export const useNetworkPromptStore = create<{ requests: NetworkPrompt[] }>(() => ({ requests: [] }));
let nextPromptId = 0;

/** Publish a host only after routing is durable; restore the prior choice if host persistence fails. */
export async function persistHostWithNetwork(
    id: string, preference: NetworkPreference, persist: () => Promise<void>,
    storage = { get: getNetworkPreference, save: saveNetworkPreference },
): Promise<void> {
    const previous = await storage.get(id);
    await storage.save(id, preference);
    try { await persist(); }
    catch (error) {
        try { await storage.save(id, previous); }
        catch { throw new Error('Host save failed and the previous network preference could not be restored. Review this host before connecting.'); }
        throw error;
    }
}

export class NetworkSelectionCancelledError extends Error {}

/** Settle only the active prompt; stale dialog callbacks cannot affect the next connection. */
export function finishNetworkPrompt(id: number, choice: NetworkChoice | null): void {
    const requests = useNetworkPromptStore.getState().requests;
    if (requests[0]?.id !== id) return;
    useNetworkPromptStore.setState({ requests: requests.slice(1) });
    requests[0].resolve(choice);
}

/** Closing/cancelling a host removes its queued picker and releases the awaiting operation. */
export function cancelNetworkPrompts(ownerId: string): void {
    const requests = useNetworkPromptStore.getState().requests;
    useNetworkPromptStore.setState({ requests: requests.filter(request => request.ownerId !== ownerId) });
    requests.filter(request => request.ownerId === ownerId).forEach(request => request.resolve(null));
}

/** Keep the prompt queue bounded while allowing unrelated hosts to finish in order. */
export function requestNetworkInterface(ownerId: string, name: string): Promise<NetworkChoice | null> {
    const requests = useNetworkPromptStore.getState().requests;
    if (requests.length >= 16) return Promise.reject(new Error('Too many connections waiting for a network interface.'));
    return new Promise(resolve => useNetworkPromptStore.setState({ requests: [...requests,
        { id: ++nextPromptId, ownerId, name, resolve }] }));
}

/** Apply only to the first local TCP hop. Backend recovery retains this ephemeral selection. */
export async function prepareNetworkInterface(
    config: ConnectConfig,
    options: { preference?: NetworkPreference; cancelled?: () => boolean; ownerId?: string;
        getPreference?: typeof getNetworkPreference; request?: typeof requestNetworkInterface } = {},
): Promise<void> {
    let firstHop = config;
    const seen = new Set<ConnectConfig>();
    while (firstHop.jump_host) {
        if (seen.has(firstHop) || seen.size >= 10) throw new Error('Jump-host chain has a cycle or is too deep.');
        seen.add(firstHop);
        firstHop = firstHop.jump_host;
    }
    const preference = options.preference && firstHop === config ? options.preference
        : await (options.getPreference ?? getNetworkPreference)(firstHop.id);
    if (options.cancelled?.()) throw new NetworkSelectionCancelledError();
    let choice: NetworkChoice = {};
    if (preference.mode === 'interface') choice = { interfaceId: preference.id };
    else if (preference.mode === 'ask') {
        const endpoint = formatConnectionEndpoint(firstHop);
        const result = await (options.request ?? requestNetworkInterface)(options.ownerId ?? config.id,
            firstHop.name === firstHop.host ? endpoint : `${firstHop.name} · ${endpoint}`);
        if (!result) throw new NetworkSelectionCancelledError();
        choice = result;
    }
    if (options.cancelled?.()) throw new NetworkSelectionCancelledError();
    firstHop.network_interface_id = choice.interfaceId;
}
