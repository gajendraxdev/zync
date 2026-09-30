import { parsePluginTerminalLaunch } from './launch.js';
import {
    PLUGIN_TERMINAL_LIMITS,
    type PluginTerminalLaunch,
    type PluginTerminalLimits,
    type PluginTerminalOwner,
    type PluginTerminalSession,
    type PluginTerminalTransport,
} from './types.js';

export interface PluginTerminalDependencies<Authority, Transport extends PluginTerminalTransport = PluginTerminalTransport> {
    /** Check the host's current runtime, frame generation and connection token. */
    isCurrent(owner: PluginTerminalOwner): boolean;
    /** Native preflight binds immutable authority to this proposal; release unused offers on abort. */
    prepare(owner: PluginTerminalOwner, launch: PluginTerminalLaunch, signal: AbortSignal): Promise<Authority>;
    /** Host-owned confirmation; permission alone does not imply user interaction. */
    confirm(owner: PluginTerminalOwner, launch: PluginTerminalLaunch, signal: AbortSignal): Promise<boolean>;
    /** Native creation must revalidate authority, grants and connection after confirmation. */
    create(authority: Authority, signal: AbortSignal): Promise<Transport>;
    /** Attach only a trusted host renderer. Never pass the transport into a plugin. */
    attach(session: PluginTerminalSession, transport: Transport): void;
    /** Synchronous renderer cleanup. The SSH channel is closed separately. */
    detach(session: PluginTerminalSession): void;
}

interface Reservation<Transport extends PluginTerminalTransport> {
    readonly session: PluginTerminalSession;
    readonly abort: AbortController;
    readonly done: Promise<void>;
    readonly finish: () => void;
    transport?: Transport;
    attached: boolean;
    closing?: Promise<void>;
    closeFailed?: boolean;
}

/** Preserve both errors without requiring a newer JS target than the desktop app. */
export class PluginTerminalOpenError extends Error {
    readonly failures: readonly unknown[];

    constructor(openError: unknown, cleanupError: unknown) {
        super('Terminal opening and cleanup failed');
        this.name = 'PluginTerminalOpenError';
        this.failures = Object.freeze([openError, cleanupError]);
    }
}

/**
 * Host lifecycle coordinator, NOT a security boundary. Native commands remain
 * responsible for grants, opaque handles, connection leases and SSH I/O limits.
 * Reservations count while approval/creation/close is pending, preventing races
 * from allocating extra terminals. Hidden panes retain a session; disposal closes it.
 */
export class PluginTerminalSessionService<Authority, Transport extends PluginTerminalTransport = PluginTerminalTransport> {
    private readonly sessions = new Map<number, Reservation<Transport>>();
    private nextId = 0;
    private disposed = false;
    private readonly limits: PluginTerminalLimits;

    constructor(
        private readonly dependencies: PluginTerminalDependencies<Authority, Transport>,
        limits: PluginTerminalLimits = PLUGIN_TERMINAL_LIMITS,
    ) {
        for (const limit of [limits.total, limits.perRuntime, limits.perPane]) {
            if (!Number.isSafeInteger(limit) || limit < 1) {
                throw new Error('Terminal session limits must be positive integers');
            }
        }
        this.limits = Object.freeze({ ...limits });
    }

    /** Includes opening and closing reservations, not just attached terminals. */
    get size(): number { return this.sessions.size; }

    /** Reserve before awaiting native authorization or asking the user. */
    async open(owner: PluginTerminalOwner, proposal: unknown): Promise<PluginTerminalSession> {
        const launch = parsePluginTerminalLaunch(proposal);
        const snapshot = Object.freeze({ ...owner });
        if (this.disposed) throw new Error('Terminal service is disposed');
        if (snapshot.connectionToken !== launch.expectedConnectionToken) {
            throw new Error('The terminal connection changed; refresh before trying again');
        }
        this.checkCurrent(snapshot);
        this.checkCapacity(snapshot);
        const record = this.reserve(snapshot);
        try {
            const authority = await this.dependencies.prepare(snapshot, launch, record.abort.signal);
            this.checkOpen(record);
            const approved = await this.dependencies.confirm(snapshot, launch, record.abort.signal);
            this.checkOpen(record);
            if (!approved) throw new Error('Terminal session was not approved');
            // Keep the reservation until a late native create resolves and is closed.
            record.transport = await this.dependencies.create(authority, record.abort.signal);
            this.checkOpen(record);
            record.attached = true;
            this.dependencies.attach(record.session, record.transport);
            // An attach callback may synchronously close its owner.
            this.checkOpen(record);
            return record.session;
        } catch (error) {
            try {
                await this.release(record);
            } catch (cleanupError) {
                throw new PluginTerminalOpenError(error, cleanupError);
            }
            throw error;
        }
    }

    /** Close a document generation without closing its replacement's sessions. */
    closeOwner(owner: PluginTerminalOwner): Promise<void> {
        return this.closeMatching(candidate => sameOwner(candidate, owner));
    }

    /** Called on worker stop/crash/reload, disable, permission revoke or uninstall. */
    closeRuntime(runtimeInstanceId: string): Promise<void> {
        return this.closeMatching(owner => owner.runtimeInstanceId === runtimeInstanceId);
    }

    /** Reconcile connection/rebind changes; hiding a pane is not a stale owner. */
    closeStale(): Promise<void> {
        return this.closeMatching(owner => !this.dependencies.isCurrent(owner));
    }

    /** Idempotent application teardown; reject any later attempt to open. */
    dispose(): Promise<void> {
        this.disposed = true;
        return this.closeMatching(() => true);
    }

    private reserve(owner: PluginTerminalOwner): Reservation<Transport> {
        let finish!: () => void;
        const done = new Promise<void>(resolve => { finish = resolve; });
        const id = ++this.nextId;
        const session: PluginTerminalSession = Object.freeze({
            id,
            owner,
            close: () => this.close(id),
        });
        const record: Reservation<Transport> = { session, abort: new AbortController(), attached: false, done, finish };
        this.sessions.set(id, record);
        return record;
    }

    private checkCurrent(owner: PluginTerminalOwner): void {
        if (!this.dependencies.isCurrent(owner)) throw new Error('Terminal owner is no longer current');
    }

    private checkOpen(record: Reservation<Transport>): void {
        if (this.disposed || record.abort.signal.aborted) throw new Error('Terminal opening was canceled');
        this.checkCurrent(record.session.owner);
    }

    private checkCapacity(owner: PluginTerminalOwner): void {
        let runtimeCount = 0;
        let paneCount = 0;
        for (const { session } of this.sessions.values()) {
            if (session.owner.runtimeInstanceId !== owner.runtimeInstanceId) continue;
            runtimeCount++;
            if (session.owner.paneInstanceId === owner.paneInstanceId) paneCount++;
        }
        if (this.sessions.size >= this.limits.total
            || runtimeCount >= this.limits.perRuntime
            || paneCount >= this.limits.perPane) throw new Error('Plugin terminal session limit reached');
    }

    private close(id: number): Promise<void> {
        const record = this.sessions.get(id);
        if (!record) return Promise.resolve();
        record.abort.abort();
        // A failed native close keeps its capacity reservation. A caller may
        // explicitly retry cleanup, but may not allocate over that reservation.
        if (record.closeFailed) {
            record.closeFailed = false;
            record.closing = undefined;
        }
        // open() owns cleanup until create resolves; it must close any late result.
        return record.transport ? this.release(record) : record.done.then(async () => {
            await record.closing;
        });
    }

    private async closeMatching(matches: (owner: PluginTerminalOwner) => boolean): Promise<void> {
        const closing = [...this.sessions.values()]
            .filter(record => matches(record.session.owner))
            .map(record => this.close(record.session.id));
        // All closures start even if one native close fails.
        const results = await Promise.allSettled(closing);
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
    }

    private release(record: Reservation<Transport>): Promise<void> {
        if (record.closing) return record.closing;
        record.abort.abort();
        // Install the promise before callbacks so synchronous re-entry is safe.
        record.closing = Promise.resolve().then(async () => {
            let nativeClosed = !record.transport;
            try {
                try {
                    if (record.attached) {
                        record.attached = false;
                        this.dependencies.detach(record.session);
                    }
                } finally {
                    await record.transport?.close();
                    nativeClosed = true;
                }
            } finally {
                record.closeFailed = !nativeClosed;
                if (nativeClosed) this.sessions.delete(record.session.id);
                record.finish();
            }
        });
        return record.closing;
    }
}

function sameOwner(left: PluginTerminalOwner, right: PluginTerminalOwner): boolean {
    return left.runtimeInstanceId === right.runtimeInstanceId
        && left.paneInstanceId === right.paneInstanceId
        && left.frameGeneration === right.frameGeneration
        && left.connectionToken === right.connectionToken;
}
