export interface AutoStartTunnelLike {
    id: string;
    name?: string;
    autoStart?: boolean;
}

export const getAutoStartTunnels = <T extends AutoStartTunnelLike>(tunnels: T[]): T[] =>
    tunnels.filter((tunnel) => tunnel.autoStart);

export const ensurePinnedFeature = (
    pinnedFeatures: string[] | undefined,
    feature: string,
): string[] | null => {
    const current = pinnedFeatures || [];
    if (current.includes(feature)) return null;
    return [...current, feature];
};

export type StartTunnelFn = (tunnelId: string, connectionId: string) => Promise<void>;
export type TunnelErrorLogger = (tunnel: AutoStartTunnelLike, error: unknown) => void;

export const startAutoStartTunnels = async (
    tunnels: AutoStartTunnelLike[],
    connectionId: string,
    startTunnel: StartTunnelFn,
    onTunnelError: TunnelErrorLogger,
): Promise<number> => {
    const autoStartTunnels = getAutoStartTunnels(tunnels);
    await Promise.all(
        autoStartTunnels.map((tunnel) =>
            startTunnel(tunnel.id, connectionId).catch((error) => {
                onTunnelError(tunnel, error);
            }),
        ),
    );
    return autoStartTunnels.length;
};

export interface PinnedFeatureConnection {
    pinnedFeatures?: string[];
}

export const pinFeatureOnConnectionIfNeeded = <T extends PinnedFeatureConnection>(
    connection: T | undefined,
    feature: string,
    editConnection: (next: T) => void,
): boolean => {
    if (!connection) return false;
    const nextPinned = ensurePinnedFeature(connection.pinnedFeatures, feature);
    if (!nextPinned) return false;
    editConnection({ ...connection, pinnedFeatures: nextPinned });
    return true;
};
