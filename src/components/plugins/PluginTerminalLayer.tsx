import { useEffect, useRef, useState, type RefObject, type MouseEvent } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { NativeTerminalPane, type NativeTerminalTransport, type TerminalOffer } from '../../features/plugins/terminal/nativeTransport';
import { registerTerminalPane } from '../../features/plugins/terminal/paneBridge';
import { allocateTerminalSurface, type TerminalSurfaceRect } from '../../features/plugins/terminal/surfaceGeometry';
import { parseTerminalSurfaceMessage } from '../../features/plugins/terminal/surfaceProtocol';
import { useAppStore } from '../../store/useAppStore';
import { buildXtermOptions } from '../../lib/terminal/xtermOptions';
import { resolveXtermTheme } from '../terminal/terminalTheme';
/** Stable host sibling: only the plugin's rectangle is shared, never xterm/PTY. */
export function PluginTerminalLayer({ iframe, runtime, pane, plugin, pluginName, serverName, visible }: {
    iframe: RefObject<HTMLIFrameElement | null>;
    runtime: string;
    pane: string;
    plugin: string;
    pluginName: string;
    serverName: string;
    visible: boolean;
}) {
    const [offer, setOffer] = useState<TerminalOffer | null>(null);
    const [rect, setRect] = useState<TerminalSurfaceRect | null>(null);
    const [viewport, setViewport] = useState({ width: 0, height: 0 });
    const [status, setStatus] = useState('Ready to open');
    const [busy, setBusy] = useState(false);
    const [running, setRunning] = useState(false);
    const [suppressed, setSuppressed] = useState(false);
    const controller = useRef<NativeTerminalPane | null>(null);
    const terminal = useRef<Terminal | null>(null);
    const fit = useRef<FitAddon | null>(null);
    const transport = useRef<NativeTerminalTransport | null>(null);
    const host = useRef<HTMLDivElement>(null);
    const alive = useRef(true);
    const blocked = useAppStore(s => Boolean(s.confirmDialog || s.isSettingsOpen || s.isAddConnectionModalOpen));
    const settings = useAppStore(s => s.settings);
    const active = visible && !document.hidden && !blocked && !suppressed && Boolean(rect);
    const activeRef = useRef(active);
    activeRef.current = active;
    const visibleRef = useRef(visible);
    visibleRef.current = visible;
    const offerRef = useRef(offer);
    offerRef.current = offer;
    useEffect(() => {
        alive.current = true;
        const nonce = crypto.randomUUID();
        let revision = 0;
        let geometryFrame = 0;
        let nextRect: TerminalSurfaceRect | null = null;
        let lastHello = -Infinity;
        let latestOffer: TerminalOffer | null = null;
        const target = new NativeTerminalPane(runtime, pane, value => {
            cancelAnimationFrame(geometryFrame);
            nextRect = null;
            latestOffer = value;
            revision = 0;
            if (alive.current) {
                setOffer(value);
                setRect(null);
            }
        });
        controller.current = target;
        const unregister = registerTerminalPane(plugin, pane, target);
        const hello = () => iframe.current?.contentWindow?.postMessage({ type: 'zync:terminal:host', version: 1, nonce }, '*');
        const message = (event: MessageEvent) => {
            if (event.source !== iframe.current?.contentWindow)
                return;
            if (event.data?.type === 'zync:terminal:hello') {
                if (performance.now() - lastHello >= 100) {
                    lastHello = performance.now();
                    hello();
                }
                return;
            }
            if (!latestOffer)
                return;
            const value = parseTerminalSurfaceMessage(event.data, nonce, latestOffer.offerId, revision);
            if (!value)
                return;
            revision = value.revision;
            if (value.dispose) {
                void target.close().catch(() => { });
                return;
            }
            nextRect = value.rect;
            cancelAnimationFrame(geometryFrame);
            geometryFrame = requestAnimationFrame(() => setRect(nextRect));
        };
        let frame = 0;
        const measure = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const node = iframe.current;
                if (!node)
                    return;
                setViewport({ width: node.clientWidth, height: node.clientHeight });
                setSuppressed(getComputedStyle(node).pointerEvents === 'none');
            });
        };
        const resize = new ResizeObserver(measure);
        if (iframe.current)
            resize.observe(iframe.current);
        const styles = new MutationObserver(measure);
        styles.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
        const visibility = () => { measure(); };
        document.addEventListener('visibilitychange', visibility);
        window.addEventListener('zync:pane-resize-end', measure);
        window.addEventListener('message', message);
        hello();
        measure();
        return () => {
            alive.current = false;
            unregister();
            target.dispose();
            transport.current?.detach();
            terminal.current?.dispose();
            terminal.current = null;
            resize.disconnect();
            styles.disconnect();
            cancelAnimationFrame(frame);
            cancelAnimationFrame(geometryFrame);
            document.removeEventListener('visibilitychange', visibility);
            window.removeEventListener('zync:pane-resize-end', measure);
            window.removeEventListener('message', message);
        };
    }, [iframe, runtime, pane, plugin]);
    useEffect(() => {
        if (!active)
            terminal.current?.blur();
        if (!active || !terminal.current || !fit.current)
            return;
        const frame = requestAnimationFrame(() => {
            fit.current?.fit();
            if (terminal.current && transport.current)
                void transport.current.resize(terminal.current.cols, terminal.current.rows).catch(() => { setStatus('Terminal resize failed'); });
        });
        return () => cancelAnimationFrame(frame);
    }, [rect, viewport, active]);
    useEffect(() => {
        const update = () => {
            if (!terminal.current)
                return;
            const options = buildXtermOptions({ settings: settings.terminal, theme: resolveXtermTheme(host.current, undefined, { enabled: false, opacity: 1 }) });
            Object.assign(terminal.current.options, options, { allowProposedApi: false, scrollback: 2000 });
            if (activeRef.current) {
                fit.current?.fit();
                if (transport.current)
                    void transport.current.resize(terminal.current.cols, terminal.current.rows).catch(() => { });
            }
        };
        const observer = new MutationObserver(update);
        observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        update();
        return () => observer.disconnect();
    }, [settings]);
    const open = async (event: MouseEvent<HTMLButtonElement>) => {
        if (!event.nativeEvent.isTrusted || !document.hasFocus() || !activeRef.current || busy || !offer)
            return;
        const proposal = offer;
        const owner = controller.current;
        if (!owner)
            return;
        setBusy(true);
        setStatus('Awaiting approval');
        try {
            const approved = await useAppStore.getState().showConfirmDialog({
                title: `Open ${pluginName} terminal?`,
                message: `Server: ${serverName}\nProgram: ${proposal.launch.program}\nArguments: ${JSON.stringify(proposal.launch.args)}\n\nThis interactive session has the connected SSH account’s full privileges. Its output stays in Zync, not the plugin.`,
                confirmText: 'Open terminal', cancelText: 'Cancel', variant: 'danger',
            });
            if (!approved) {
                await owner.close();
                return;
            }
            if (!alive.current || offerRef.current !== proposal || !visibleRef.current || document.hidden)
                return;
            const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
            if (!alive.current || offerRef.current !== proposal || !visibleRef.current || document.hidden || !host.current)
                return;
            terminal.current?.dispose();
            const instance = new Terminal({ ...buildXtermOptions({ settings: useAppStore.getState().settings.terminal, theme: resolveXtermTheme(host.current, undefined, { enabled: false, opacity: 1 }) }), allowProposedApi: false, scrollback: 2000 });
            const fitter = new FitAddon();
            instance.loadAddon(fitter);
            instance.open(host.current);
            fitter.fit();
            terminal.current = instance;
            fit.current = fitter;
            instance.parser.registerOscHandler(52, () => true); // Never service remote clipboard escape sequences.
            instance.onData(text => { if (activeRef.current)
                transport.current?.write(text); });
            setStatus('Opening');
            const stream = await owner.start(proposal, { cols: instance.cols, rows: instance.rows }, instance, reason => {
                if (alive.current) {
                    setRunning(false);
                    setStatus(reason ?? 'Session exited');
                }
            }, stream => { transport.current = stream; });
            if (!alive.current) {
                await stream.close();
                return;
            }
            transport.current = stream;
            if (stream.active) {
                setRunning(true);
                setStatus('Connected');
            }
            if (activeRef.current)
                instance.focus();
        }
        catch (error) {
            if (alive.current)
                setStatus(error instanceof Error ? error.message : 'Terminal could not open');
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    };
    const close = () => {
        transport.current?.detach();
        transport.current = null;
        terminal.current?.dispose();
        terminal.current = null;
        setRunning(false);
        setBusy(false);
        void controller.current?.close().catch(() => { setStatus('Terminal cleanup is still pending'); });
    };
    if (!offer)
        return null;
    const allocation = rect && allocateTerminalSurface(rect, viewport);
    const slot = allocation?.terminal ?? rect ?? { x: 0, y: 0, width: 0, height: 0 };
    const clip = allocation?.clip;
    return <div className="absolute z-20 overflow-hidden" style={{ display: active && clip && slot.width >= 240 && slot.height >= 100 ? undefined : 'none', left: clip?.x ?? 0, top: clip?.y ?? 0, width: clip?.width ?? 0, height: clip?.height ?? 0 }}>
        <section className="absolute flex flex-col bg-app-bg border border-app-border" style={{ left: allocation?.offset.x ?? 0, top: allocation?.offset.y ?? 0, width: slot.width, height: slot.height }} aria-label={`${pluginName} terminal on ${serverName}`}>
            <header className="h-8 shrink-0 flex items-center gap-2 px-2 bg-app-panel text-xs border-b border-app-border">
                <span className="truncate">Zync terminal · {pluginName} · {serverName}</span>
                <span role="status" className="truncate text-muted-foreground" title={status}>{status}</span>
                {!running && <button className="ml-auto shrink-0 text-app-accent" disabled={busy || Boolean(terminal.current)} onClick={event => { void open(event); }}>Open terminal</button>}
                <button className="ml-auto shrink-0" aria-label="Close terminal" onClick={close}>×</button>
            </header>
            <div ref={host} className="flex-1 min-h-0 overflow-hidden p-1"/>
        </section>
    </div>;
}
