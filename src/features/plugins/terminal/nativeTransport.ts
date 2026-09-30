import { Channel, invoke } from '@tauri-apps/api/core';
import { terminalOutputMessageToArrayBuffer } from '../../../lib/terminal/terminalOutputFrame.js';
import { parsePluginTerminalLaunch } from './launch';
import type { PluginTerminalLaunch } from './types';
interface DocumentBinding {
    documentId: string;
    connectionToken: string;
}
export interface TerminalOffer {
    readonly offerId: string;
    readonly launch: PluginTerminalLaunch;
}
export interface TerminalSink {
    write(bytes: Uint8Array, done: () => void): void;
}
/** A host-only native document lease. None of its IDs or transports leave Zync. */
export class NativeTerminalPane {
    private binding?: Promise<DocumentBinding>;
    private disposed = false;
    private preparing = false;
    private generation = 0;
    private nativeOffer?: string;
    private publicOffer?: TerminalOffer;
    private expiry?: ReturnType<typeof setTimeout>;
    constructor(private readonly runtime: string, private readonly pane: string, private readonly changed: (offer: TerminalOffer | null) => void) { }
    private async document(runtime: string): Promise<DocumentBinding> {
        if (this.disposed || runtime !== this.runtime)
            throw new Error('Terminal pane owner changed');
        if (!this.binding) {
            const registration = invoke<DocumentBinding>('plugins_terminal_document_register', { runtimeInstanceId: runtime, paneInstanceId: this.pane });
            this.binding = registration;
            void registration.catch(() => { if (this.binding === registration)
                this.binding = undefined; });
        }
        const binding = await this.binding;
        if (this.disposed) {
            await invoke('plugins_terminal_document_dispose', { documentId: binding.documentId });
            throw new Error('Terminal document was disposed');
        }
        return binding;
    }
    async context(runtime: string): Promise<{
        connectionToken: string;
    }> {
        return { connectionToken: (await this.document(runtime)).connectionToken };
    }
    async prepare(runtime: string, request: unknown): Promise<{
        offerId: string;
        expiresInMs: number;
    }> {
        const launch = parsePluginTerminalLaunch(request);
        if (this.preparing || this.publicOffer)
            throw new Error('This pane already has a terminal proposal or session');
        this.preparing = true;
        const generation = this.generation;
        try {
            const binding = await this.document(runtime);
            const id = await invoke<string>('plugins_terminal_prepare', { documentId: binding.documentId, request: launch });
            if (this.disposed || generation !== this.generation) {
                await invoke('plugins_terminal_close', { documentId: binding.documentId, terminalId: id });
                throw new Error('Terminal pane was disposed during preparation');
            }
            this.nativeOffer = id;
            this.publicOffer = Object.freeze({ offerId: crypto.randomUUID(), launch });
            this.expiry = setTimeout(() => { void this.close().catch(() => { }); }, 60000);
            this.changed(this.publicOffer);
            return { offerId: this.publicOffer.offerId, expiresInMs: 60000 };
        }
        finally {
            this.preparing = false;
        }
    }
    async start(offer: TerminalOffer, size: {
        cols: number;
        rows: number;
    }, sink: TerminalSink, ended: (reason: string | null) => void, attach: (transport: NativeTerminalTransport) => void): Promise<NativeTerminalTransport> {
        if (this.disposed || this.publicOffer !== offer || !this.nativeOffer)
            throw new Error('Terminal offer expired or changed');
        const binding = await this.document(this.runtime);
        const terminalId = this.nativeOffer;
        const approvalToken = await invoke<string>('plugins_terminal_approve', { documentId: binding.documentId, offerId: terminalId });
        if (this.disposed || this.publicOffer !== offer)
            throw new Error('Terminal document changed during approval');
        clearTimeout(this.expiry);
        const transport = new NativeTerminalTransport(binding.documentId, terminalId, sink, ended);
        attach(transport);
        try {
            await invoke('plugins_terminal_start', { documentId: binding.documentId, offerId: terminalId, approvalToken, size, output: transport.output, events: transport.events });
            transport.markStarted();
            if (this.disposed || this.publicOffer !== offer) {
                await transport.close();
                throw new Error('Terminal document changed during startup');
            }
            return transport;
        }
        catch (error) {
            transport.detach();
            void this.close().catch(() => { });
            throw error;
        }
    }
    async close(): Promise<void> {
        this.generation++;
        clearTimeout(this.expiry);
        const id = this.nativeOffer;
        const binding = this.binding;
        this.binding = undefined;
        this.nativeOffer = undefined;
        this.publicOffer = undefined;
        this.changed(null);
        if (binding) {
            const { documentId } = await binding;
            await invoke('plugins_terminal_document_dispose', { documentId });
            if (id) await invoke('plugins_terminal_close', { documentId, terminalId: id });
        }
    }
    dispose(): void {
        this.disposed = true;
        clearTimeout(this.expiry);
        if (this.binding)
            void this.binding.then(binding => invoke('plugins_terminal_document_dispose', { documentId: binding.documentId })).catch(() => { });
        void this.close().catch(() => { });
    }
}
/** Binary output stays in the host. Credits are sent only after xterm writes. */
export class NativeTerminalTransport {
    readonly output = new Channel<ArrayBuffer | Uint8Array>();
    readonly events = new Channel<{
        type: string;
        reason?: string | null;
    }>();
    private attached = true;
    private ready = false;
    private sequence = 0;
    private inputBytes = 0;
    private input = Promise.resolve();
    private acknowledgements = Promise.resolve();
    constructor(private readonly documentId: string, private readonly terminalId: string, sink: TerminalSink, private readonly ended: (reason: string | null) => void) {
        this.output.onmessage = message => {
            if (!this.attached)
                return;
            const frame = terminalOutputMessageToArrayBuffer(message);
            if (!frame || frame.byteLength < 5 || frame.byteLength > 16388) {
                this.fail(this.ended);
                return;
            }
            const sequence = new DataView(frame).getUint32(0, true);
            if (sequence !== ++this.sequence) {
                this.fail(this.ended);
                return;
            }
            this.ready = true; // Native output is emitted only after PTY startup.
            sink.write(new Uint8Array(frame, 4), () => {
                if (!this.attached)
                    return;
                this.acknowledgements = this.acknowledgements.then(() => this.attached ? this.call('ack', { sequence }) : undefined).catch(() => this.fail(this.ended));
            });
        };
        this.events.onmessage = event => {
            if (this.attached && event.type === 'closed') {
                this.detach();
                this.ended(event.reason ?? null);
            }
        };
    }
    private call(action: string, args: Record<string, unknown>): Promise<void> {
        return invoke(`plugins_terminal_${action}`, { documentId: this.documentId, terminalId: this.terminalId, ...args });
    }
    private fail(ended: (reason: string | null) => void): void {
        this.detach();
        ended('Terminal transport stopped; close and request a new session');
        void this.call('close', {}).catch(() => { });
    }
    write(text: string): void {
        if (!this.attached || !this.ready)
            return;
        if (text.length > 64 * 1024) {
            this.fail(this.ended);
            return;
        }
        const bytes = new TextEncoder().encode(text);
        if (this.inputBytes + bytes.length > 64 * 1024) {
            this.fail(this.ended);
            return;
        }
        this.inputBytes += bytes.length;
        this.input = this.input.then(async () => {
            for (let offset = 0; offset < bytes.length && this.attached; offset += 4096)
                await this.call('write', { data: Array.from(bytes.subarray(offset, offset + 4096)) });
        }).catch(() => this.fail(this.ended)).finally(() => { this.inputBytes -= bytes.length; });
    }
    resize(cols: number, rows: number): Promise<void> { return this.attached ? this.call('resize', { size: { cols, rows } }) : Promise.resolve(); }
    get active(): boolean { return this.attached; }
    markStarted(): void { if (this.attached)
        this.ready = true; }
    detach(): void { this.attached = false; this.output.onmessage = () => { }; this.events.onmessage = () => { }; }
    close(): Promise<void> { this.detach(); return this.call('close', {}); }
}
