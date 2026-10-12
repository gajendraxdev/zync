import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChromeActionsSection } from '../src/components/settings/tabs/layout/ChromeActionsSection';
import { ChromeActionItems } from '../src/components/layout/ChromeActionItems';
import { chromeVisibilityMenu } from '../src/components/layout/chromeVisibilityMenu';
import { ContextMenu } from '../src/components/ui/ContextMenu';
import { CHROME_ACTIONS, parseChromeActions, type ChromeActionArea, type ChromeActionId } from '../src/features/workspace/domain/chromeActions';
import { createChromeActionUpdater } from '../src/features/workspace/application/updateChromeActions';
import { Button } from '../src/components/ui/Button';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import '../src/index.css';
import './uiOverlays.browser.css';

// Isolated metadata/native acknowledgement simulation. No real settings, PTY or plugin I/O.
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
async function until(condition: () => boolean) {
    for (let frame = 0; frame < 180; frame++) { if (condition()) return; await settle(); }
    throw Error('Fixture condition did not settle');
}
function Fixture() {
    const [value, setValue] = useState<unknown>();
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');
    const [result, setResult] = useState('Not run'); const [running, setRunning] = useState(false);
    const [menu, setMenu] = useState<{ area: ChromeActionArea; x: number; y: number } | null>(null);
    const [menuBusy, setMenuBusy] = useState(false);
    const [menuError, setMenuError] = useState('');
    const snapshot = useRef({ loading: false, generation: 0, value: undefined as unknown });
    const failure = useRef(false); const hold = useRef(false); const release = useRef<(() => void) | null>(null);
    const calls = useRef(0); const saves = useRef(0);
    const replace = (next: unknown) => { snapshot.current = { ...snapshot.current, value: next }; setValue(next); };
    const update = useMemo(() => createChromeActionUpdater({
        read: () => ({ ...snapshot.current }),
        save: async () => {
            saves.current++;
            if (hold.current) await new Promise<void>(resolve => { release.current = resolve; });
            if (failure.current) throw Error('Fixture save failure with internal details');
        },
        publish: (before, next) => {
            if (snapshot.current.generation !== before.generation || snapshot.current.value !== before.value) return false;
            replace(next); return true;
        },
    }), []);
    useEffect(() => { document.body.dataset.overlayGalleryTheme = theme; }, [theme]);
    const action = async (label: string) => {
        const button = [...document.querySelectorAll<HTMLButtonElement>('[data-editor] button')].find(node => node.getAttribute('aria-label') === label || node.textContent === label);
        if (!button || button.disabled) throw Error(`Unavailable action: ${label}`);
        button.focus(); flushSync(() => button.click());
        if (!hold.current) await until(() => !document.querySelector('[data-editor] [aria-busy="true"]'));
        await settle(); return button;
    };
    const order = (area: string) => [...document.querySelectorAll(`[data-preview="${area}"] [data-action-id]`)].map(node => node.getAttribute('data-action-id'));
    const run = async () => {
        setRunning(true); setResult('Running…'); const reports: string[] = [];
        const check = (ok: unknown, label: string) => { if (!ok) throw Error(label); reports.push(label); };
        try {
            failure.current = false; hold.current = false; calls.current = 0; saves.current = 0;
            flushSync(() => replace(undefined)); await settle();
            const frame = document.querySelector<HTMLIFrameElement>('iframe')!;
            await until(() => Boolean(frame.contentDocument?.querySelector('input')));
            const doc = frame.contentDocument;
            const retainedInput = doc?.querySelector('input')!; retainedInput.value = 'Retain this draft';
            const protectedNode = document.querySelector('[data-action-id="status.updates"]')!;
            check(order('workspaceToolbar').join() === 'terminal.find,workspace.splits,workspace.sessionTools', 'Default toolbar order is unchanged');
            await action('Find in terminal');
            check(!order('workspaceToolbar').includes('terminal.find') && calls.current === 0, 'Hide changes chrome without executing a command');
            failure.current = true; await action('Find in terminal');
            check(!order('workspaceToolbar').includes('terminal.find') && Boolean(document.querySelector('[role="alert"]')), 'Refused save preserves applied visibility and offers retry');
            check(!document.body.textContent?.includes('internal details'), 'Save failure does not leak internal error text');
            failure.current = false; await action('Find in terminal');
            check(order('workspaceToolbar').includes('terminal.find') && !document.querySelector('[role="alert"]'), 'Retry restores visibility and clears the error');
            const openVisibility = (area: ChromeActionArea) => flushSync(() => {
                document.querySelector(`[data-preview="${area}"]`)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
            });
            openVisibility('workspaceToolbar'); await settle();
            let checkbox = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
            check(checkbox.getAttribute('aria-checked') === 'true', 'Context menu shows saved visible actions as checked');
            flushSync(() => checkbox.click()); await settle();
            check(!order('workspaceToolbar').includes('terminal.find') && !document.querySelector('[role="menu"]'), 'Context checkbox hides chrome and closes the menu');
            openVisibility('workspaceToolbar'); await settle();
            checkbox = document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!;
            check(checkbox.getAttribute('aria-checked') === 'false', 'Hidden actions remain listed unchecked for recovery');
            flushSync(() => checkbox.click()); await settle();
            check(order('workspaceToolbar').includes('terminal.find'), 'Context checkbox restores hidden chrome without commands');
            openVisibility('statusBar'); await settle();
            let statusCheckboxes = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
            check(statusCheckboxes.map(node => node.textContent?.trim()).join() === 'Editor position,AI assistant', 'Status context menu matches Settings optional choices without protected rows');
            flushSync(() => statusCheckboxes[0].click()); await settle();
            check(!order('statusBar').includes('status.editor') && protectedNode === document.querySelector('[data-action-id="status.updates"]'), 'Status menu hides optional chrome while retaining essential indicators');
            openVisibility('statusBar'); await settle();
            statusCheckboxes = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemcheckbox"]')];
            check(statusCheckboxes[0].getAttribute('aria-checked') === 'false', 'Hidden status actions remain in the menu for recovery');
            flushSync(() => statusCheckboxes[0].click()); await settle();
            check(order('statusBar').includes('status.editor'), 'Status context menu restores the hidden optional action');
            check(!document.querySelector('[data-editor] button[aria-label^="Move "]'), 'Settings provides visibility and reset without reposition controls');
            check(!document.querySelector('[data-editor] [draggable="true"]'), 'Customization has no drag handles or draggable controls');
            const destination = document.querySelector('[data-chrome-action-row="workspace.splits"]')!;
            const writesBefore = saves.current;
            const external = new DataTransfer(); external.setData('application/x-zync-chrome-action', 'terminal.find');
            flushSync(() => destination.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: external })));
            await settle(); check(saves.current === writesBefore, 'Dropping drag data cannot reorder or write preferences');
            await action('AI assistant');
            await action('Find in terminal'); await action('Split controls'); await action('Session tools');
            check(order('workspaceToolbar').length === 0, 'Every optional toolbar cluster can be hidden');
            await action('Reset toolbar');
            check(order('workspaceToolbar').length === 3 && !order('statusBar').includes('status.ai'), 'Area reset restores toolbar only, preserving status choices');
            const statusEditor = document.querySelector('[data-chrome-customization="statusBar"]')!;
            check([...statusEditor.querySelectorAll('[data-chrome-action-row]')].map(row => row.getAttribute('data-chrome-action-row')).join() === 'status.editor,status.ai'
                && statusEditor.textContent?.includes('Essential status indicators'), 'Settings lists only configurable status rows with one essential-indicator note');
            check([...document.querySelectorAll('[data-editor] [role="switch"]')].every(button => button.textContent?.includes(button.getAttribute('aria-label')!)),
                'Visibility rows use shared clickable labels like navigation');
            check(protectedNode === document.querySelector('[data-action-id="status.updates"]'), 'Visibility edits retain the exact protected indicator node');
            hold.current = true;
            const pending = action('Find in terminal'); await until(() => release.current !== null); await pending;
            check(order('workspaceToolbar').includes('terminal.find') && document.querySelector('[aria-label="Find in terminal"]')?.hasAttribute('disabled'), 'Pending save disables repeated edits without optimistic hiding');
            hold.current = false; release.current!(); release.current = null; await settle();
            check(!order('workspaceToolbar').includes('terminal.find'), 'Acknowledged save applies the requested visibility');
            check(document.activeElement?.getAttribute('aria-label') === 'Find in terminal', 'Visibility save returns focus to its switch');
            const unknown = { version: 99, future: true };
            flushSync(() => replace(unknown)); await settle();
            check(order('workspaceToolbar').length === 3 && document.querySelector('[role="alert"]'), 'Future settings render safe defaults with a read-only warning');
            check([...document.querySelectorAll<HTMLButtonElement>('[data-editor] button')].every(button => button.disabled), 'Unsupported settings disable editor and reset without discarding data');
            check(snapshot.current.value === unknown, 'Unknown raw preferences remain untouched');
            flushSync(() => replace(undefined)); await settle();
            check(doc === frame.contentDocument && retainedInput === frame.contentDocument?.querySelector('input') && retainedInput.value === 'Retain this draft', 'Chrome edits preserve loaded sibling content and its input draft');
            check(calls.current === 0, 'Editing preferences never executes registered feature actions');
            setResult(`Passed ${reports.length} checks\n${reports.join('\n')}`);
        } catch (error) { setResult(`FAILED: ${String(error)}\n${reports.join('\n')}`); }
        finally { hold.current = false; release.current?.(); release.current = null; setRunning(false); }
    };
    const slots = Object.fromEntries(CHROME_ACTIONS.map(item => [item.id,
        <button key={item.id} type="button" data-action-id={item.id} className="rounded border border-app-border px-2 py-1" onClick={() => calls.current++}>{item.label}</button>,
    ])) as Record<ChromeActionId, React.ReactNode>;
    const previewMenu = (area: ChromeActionArea, event: React.MouseEvent) => {
        event.preventDefault(); setMenu({ area, x: event.clientX, y: event.clientY });
    };
    return <main className="overlay-gallery">
        <h1>Toolbar and status customization</h1>
        <p>Production editor and action projection; isolated in-memory save acknowledgements.</p>
        <div className="flex flex-wrap gap-2 my-4">
            <Button disabled={running} onClick={() => void run()}>Run customization checks</Button>
            <Button variant="secondary" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>Switch theme</Button>
        </div>
        <pre role="status" className="max-h-40 overflow-auto text-xs whitespace-pre-wrap">{result}</pre>
        <div data-preview="workspaceToolbar" aria-label="Toolbar preview" onContextMenu={event => previewMenu('workspaceToolbar', event)} className="my-4 flex flex-wrap gap-2"><ChromeActionItems value={value} area="workspaceToolbar" slots={slots} /></div>
        <div data-preview="statusBar" aria-label="Status preview" onContextMenu={event => previewMenu('statusBar', event)} className="my-4 flex flex-wrap gap-2"><ChromeActionItems value={value} area="statusBar" slots={slots} /></div>
        {menu && <ContextMenu x={menu.x} y={menu.y} ariaLabel="Visibility preview" onClose={() => setMenu(null)}
            items={chromeVisibilityMenu(value, menu.area, (id, hidden) => {
                setMenuBusy(true); setMenuError('');
                void update({ type: 'hidden', id, value: hidden }).catch(() => setMenuError('Fixture visibility save refused.'))
                    .finally(() => setMenuBusy(false));
            }, menuBusy)} />}
        {menuError && <p role="alert">{menuError}</p>}
        <div data-editor className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChromeActionsSection value={value} area="workspaceToolbar" onChange={update} />
            <ChromeActionsSection value={value} area="statusBar" onChange={update} />
        </div>
        <iframe title="Retained content" srcDoc='<label>Draft <input value="initial"></label>' className="mt-6 h-24 w-full bg-white" />
    </main>;
}
const root = createRoot(document.getElementById('root')!); root.render(<TooltipProvider><Fixture /></TooltipProvider>);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
