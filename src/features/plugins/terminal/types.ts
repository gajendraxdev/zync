/** Host-only ownership snapshot. Never construct this from a plugin message. */
export interface PluginTerminalOwner {
    readonly runtimeInstanceId: string;
    readonly paneInstanceId: string;
    readonly frameGeneration: number;
    readonly connectionToken: string;
}

/** A proposed POSIX program launch, not permission to execute it. */
export interface PluginTerminalLaunch {
    readonly program: string;
    readonly args: readonly string[];
    readonly expectedConnectionToken: string;
}

/**
 * Adapter implemented by the native broker, not by an iframe or Worker.
 * The native side must retain ownership, permission and connection checks.
 */
export interface PluginTerminalTransport {
    close(): Promise<void>;
}

export interface PluginTerminalSession {
    /** UI identity only; not a native capability or an SSH terminal ID. */
    readonly id: number;
    readonly owner: PluginTerminalOwner;
    close(): Promise<void>;
}

export interface PluginTerminalLimits {
    readonly total: number;
    readonly perRuntime: number;
    readonly perPane: number;
}

/** Conservative initial limits, separate from the user's workspace terminals. */
export const PLUGIN_TERMINAL_LIMITS: PluginTerminalLimits = Object.freeze({
    total: 8,
    perRuntime: 4,
    perPane: 1,
});
