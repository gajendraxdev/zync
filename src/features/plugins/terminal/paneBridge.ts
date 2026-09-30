/** Worker proposals are routed to an existing host-owned pane, never a new host. */
export interface TerminalPaneTarget {
    context(runtime: string): Promise<{
        connectionToken: string;
    }>;
    prepare(runtime: string, request: unknown): Promise<{
        offerId: string;
        expiresInMs: number;
    }>;
}
const targets = new Map<string, TerminalPaneTarget>();
const key = (plugin: string, pane: string) => `${plugin}\0${pane}`;
export function registerTerminalPane(plugin: string, pane: string, target: TerminalPaneTarget): () => void {
    const identity = key(plugin, pane);
    targets.set(identity, target);
    return () => { if (targets.get(identity) === target)
        targets.delete(identity); };
}
export async function handleTerminalWorkerMessage(plugin: string, runtime: string | undefined, type: string, payload: Record<string, unknown> | undefined): Promise<unknown> {
    if (!runtime || typeof payload?.paneInstanceId !== 'string')
        throw new Error('An active plugin pane is required');
    const target = targets.get(key(plugin, payload.paneInstanceId));
    if (!target)
        throw new Error('Terminal surface is not ready; wait for pane load');
    return type === 'api:terminal:context' ? target.context(runtime) : target.prepare(runtime, payload.request);
}
