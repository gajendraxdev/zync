import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { flushSync } from 'react-dom';
import { Terminal } from '@xterm/xterm';
import { AppearanceElementColorsSection } from '../src/components/settings/tabs/appearance/AppearanceElementColorsSection';
import { Button } from '../src/components/ui/Button';
import { Input } from '../src/components/ui/Input';
import { PaneHeader } from '../src/components/workspace/PaneHeader';
import { changeElementColors, parseElementColors, type ElementColorChange } from '../src/features/appearance/domain/elementColors';
import { useElementColorStyle } from '../src/features/appearance/presentation/useElementColorStyle';
import { createElementColorStyle } from '../src/features/appearance/presentation/elementColorStyle';
import { applyXtermTheme } from '../src/components/terminal/terminalTheme';
import { getTerminalDocument } from '../src/lib/terminal/terminalDocument';
import '../src/index.css';
import './uiOverlays.browser.css';
import '@xterm/xterm/css/xterm.css';

// Isolated in-memory preferences and renderer only. No native commands, real settings,
// PTY, network connection or plugin worker is started by this development fixture.
const waitForPaint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const check = (condition: unknown, message: string) => { if (!condition) throw Error(message); };
const textColor = (node: Element) => getComputedStyle(node).color;
const background = (node: Element) => getComputedStyle(node).backgroundColor;

function Fixture() {
    const [value, setValue] = useState<unknown>();
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');
    const [failure, setFailure] = useState(false);
    const [result, setResult] = useState('Not run');
    const [running, setRunning] = useState(false);
    const host = useRef<HTMLDivElement>(null);
    const terminal = useRef<Terminal | null>(null);
    const refreshes = useRef(0);
    const repaint = useCallback(() => {
        refreshes.current++;
        if (terminal.current) applyXtermTheme(terminal.current, host.current, undefined, { enabled: false, opacity: 1 });
    }, []);
    useElementColorStyle(value, repaint);
    useEffect(() => {
        document.body.dataset.overlayGalleryTheme = theme;
        document.body.dataset.theme = theme;
        repaint();
    }, [theme, repaint]);
    useEffect(() => {
        const instance = new Terminal({ cols: 42, rows: 5, cursorBlink: true, documentOverride: getTerminalDocument(document) });
        instance.open(host.current!); instance.write('Retained terminal buffer\r\n$ echo ready\r\nready\r\n$ ');
        terminal.current = instance; repaint();
        return () => { instance.dispose(); terminal.current = null; };
    }, [repaint]);
    const save = async (change: ElementColorChange) => {
        await Promise.resolve();
        if (failure) throw Error('Fixture acknowledgement failure');
        setValue((current: unknown) => changeElementColors(parseElementColors(current)!, change));
    };
    const run = async () => {
        setRunning(true); setResult('Running…');
        const previous = value;
        const reports: string[] = [];
        const change = async (overrides: Record<string, string>) => {
            flushSync(() => setValue({ version: 1, overrides })); await waitForPaint();
        };
        try {
            await change({});
            const main = document.querySelector('[data-fixture-main]')!;
            const control = document.querySelector<HTMLInputElement>('[data-fixture-control]')!;
            const error = document.querySelector('[data-fixture-error]')!;
            const dialog = document.querySelector('[data-fixture-dialog]')!;
            const danger = document.querySelector('[data-fixture-danger]')!;
            const plugin = document.querySelector<HTMLIFrameElement>('[data-fixture-plugin]')!;
            const instance = terminal.current!;
            const terminalElement = instance.element;
            const line = instance.buffer.active.getLine(0)?.translateToString();
            await Promise.allSettled([control, error, dialog, danger].flatMap(node => node.getAnimations()).map(animation => animation.finished));
            const initial = { main: background(main), control: background(control), error: background(error), dialog: background(dialog), danger: background(danger) };
            const before = refreshes.current;
            await change({ 'mainTabs.background': '#123456', 'control.background': '#234567', 'control.foreground': '#ffffff' });
            await Promise.allSettled(control.getAnimations().map(animation => animation.finished));
            check(background(main) === 'rgb(18, 52, 86)' && background(control) === 'rgb(35, 69, 103)', `host colors applied: ${background(main)} / ${background(control)}`);
            check(background(error) === initial.error && background(dialog) === initial.dialog && background(danger) === initial.danger, 'protected semantics unchanged');
            check(refreshes.current === before, 'chrome-only changes do not repaint terminals');
            reports.push('host colors', 'dialog/error/danger protection', 'chrome-only refresh isolation');
            await change({ 'terminal.background': '#112233', 'terminal.foreground': '#eeeeee', 'terminal.cursor': '#aabbcc' });
            check(instance.options.theme?.cursor === '#aabbcc' && instance.options.theme?.foreground === '#eeeeee', 'terminal theme adapter');
            check(instance === terminal.current && terminalElement === instance.element && line === instance.buffer.active.getLine(0)?.translateToString(), 'retained xterm and buffer');
            check(document.querySelector('[data-fixture-plugin]') === plugin && plugin.isConnected, 'retained iframe');
            reports.push('terminal theme', 'xterm/buffer identity', 'iframe identity');
            control.focus(); const focused = document.activeElement;
            await change({ 'sidebar.background': '#334455' });
            check(document.activeElement === focused, 'no focus theft'); reports.push('focus ownership');
            flushSync(() => setValue({ version: 999, overrides: { 'mainTabs.background': '#000000' } })); await waitForPaint();
            check(!document.querySelector('style[data-zync-element-colors]') && background(main) === initial.main, 'unsupported data inherits');
            reports.push('unsupported-data inheritance');
            await change({ 'mainTabs.background': '#123456' });
            const opposite = theme === 'dark' ? 'light' : 'dark';
            document.body.dataset.overlayGalleryTheme = opposite; document.body.dataset.theme = opposite;
            await waitForPaint(); check(background(main) === 'rgb(18, 52, 86)', 'override survives theme change');
            await change({}); check(background(main) !== initial.main, 'reset follows new theme');
            reports.push('theme change', 'reset inheritance');

            // Release-style nonce policy in a separate document; no relaxation of application CSP.
            const frame = document.createElement('iframe'); frame.title = 'Isolated nonce regression';
            const loaded = new Promise<void>(resolve => { frame.onload = () => resolve(); });
            frame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-fixture-only';"><style nonce="fixture-only">body{color:#fff;background:#000}</style><div data-zync-color="mainTabs">Nonce test</div>`;
            document.body.appendChild(frame);
            try {
                await loaded;
                const inner = frame.contentDocument!; const owner = createElementColorStyle(inner, () => {});
                try {
                    owner.update({ version: 1, overrides: { 'mainTabs.background': '#123456' } }); await waitForPaint();
                    const style = inner.querySelector<HTMLStyleElement>('style[data-zync-element-colors]')!;
                    check(style.nonce === 'fixture-only' && frame.contentWindow!.getComputedStyle(inner.querySelector('div')!).backgroundColor === 'rgb(18, 52, 86)', 'nonce authorizes actual CSS under strict CSP');
                    check(textColor(main).length > 0, 'host still rendered');
                    reports.push('strict style CSP');
                } finally { owner.dispose(); }
                check(!inner.querySelector('style[data-zync-element-colors]'), 'style owner cleanup'); reports.push('style disposal');
            } finally { frame.remove(); }
            setResult(`PASS ${reports.length}: ${reports.join(', ')}`);
        } catch (error) { setResult(`FAIL: ${error instanceof Error ? error.message : String(error)}`); }
        finally {
            document.body.dataset.overlayGalleryTheme = theme; document.body.dataset.theme = theme;
            setValue(previous); setRunning(false);
        }
    };
    return <main className="overlay-gallery">
        <h1>Element colors</h1>
        <p>Production controls and runtime styling with isolated test data. No native persistence or sessions.</p>
        <div className="flex flex-wrap gap-2 my-3">
            <Button onClick={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}>Switch to {theme === 'dark' ? 'light' : 'dark'}</Button>
            <Button variant="secondary" aria-pressed={failure} onClick={() => setFailure(current => !current)}>Fail saves</Button>
            <Button variant="secondary" disabled={running} onClick={() => { void run(); }}>Run color checks</Button>
            <Button variant="secondary" onClick={() => setValue({ version: 99, overrides: {} })}>Load unsupported data</Button>
            <Button variant="secondary" onClick={() => setValue(undefined)}>Reset fixture</Button>
        </div>
        <output aria-live="polite" data-testid="color-results">{result}</output>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mt-5">
            <div className="space-y-3">
                <div data-fixture-main data-zync-color="mainTabs" className="bg-app-bg border border-app-border p-3">Main tabs</div>
                <PaneHeader label="Example pane" defaultTitle="Example pane" icon={<span>□</span>} onPointerDown={() => {}} onRename={() => {}} onClose={() => {}} />
                <Input data-fixture-control label="Neutral host input" placeholder="Focus stays here during color changes" />
                <Input data-fixture-error label="Error control" error="Protected error styling" />
                <div role="dialog" aria-label="Protected dialog sample"><Input data-fixture-dialog label="Dialog input" /></div>
                <Button variant="danger" data-fixture-danger>Protected danger action</Button>
                <div ref={host} aria-label="Retained xterm" className="min-h-28 overflow-hidden" />
                <iframe data-fixture-plugin title="Retained plugin sample" className="h-16 w-full" srcDoc="<p>Plugin content retains its own colors.</p>" />
            </div>
            <AppearanceElementColorsSection value={value} active loading={running} onChange={save} />
        </div>
    </main>;
}

const root = createRoot(document.getElementById('root')!);
root.render(<TooltipProvider delayDuration={120}><Fixture /></TooltipProvider>);
import.meta.hot?.dispose(() => root.unmount());
