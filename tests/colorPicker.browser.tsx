import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ColorPicker } from '../src/components/ui/ColorPicker';
import { Modal } from '../src/components/ui/Modal';
import { Button } from '../src/components/ui/Button';
import { popupIsUnclipped } from './helpers/popupVisibility.browser';
import '../src/index.css';
import './uiOverlays.browser.css';

// Production picker inside a production Modal; all data is local and disposable.
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function Fixture() {
    const [value, setValue] = useState('#334455');
    const [saved, setSaved] = useState(value);
    const [light, setLight] = useState(false);
    const [disabled, setDisabled] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState('Not run');
    const drafts = useRef(0); const saves = useRef(0);
    useEffect(() => { document.body.dataset.overlayGalleryTheme = light ? 'light' : 'dark'; }, [light]);
    const run = async () => {
        setRunning(true); setResult('Running…'); const reports: string[] = [];
        const check = (condition: unknown, label: string) => { if (!condition) throw Error(label); reports.push(label); };
        const dialog = () => document.querySelector<HTMLElement>('[aria-label="Background color picker"]')!;
        const trigger = () => document.querySelector<HTMLButtonElement>('[aria-label="Edit Background color"]')!;
        const input = (label: string) => dialog().querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)
            ?? [...dialog().querySelectorAll<HTMLLabelElement>('label')].filter(node => node.textContent === label)
                .map(node => document.getElementById(node.htmlFor) as HTMLInputElement)[0];
        const edit = async (label: string, text: string) => {
            const node = input(label);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, text);
            flushSync(() => node.dispatchEvent(new Event('input', { bubbles: true }))); await settle();
        };
        const open = async () => { trigger().click(); await settle(); await settle(); };
        try {
            flushSync(() => { setValue('#334455'); setSaved('#334455'); setDisabled(false); setModalOpen(true); });
            await settle(); await settle(); drafts.current = 0; saves.current = 0;
            await open();
            check(Boolean(dialog()) && document.activeElement === input('Hex color'), 'Opening focuses hex without changing the draft');
            check(drafts.current === 0 && saves.current === 0, 'Opening never saves or emits a color');
            const hue = input('Hue');
            check(hue.type === 'range' && hue.classList.contains('zync-color-picker-hue')
                && getComputedStyle(hue).appearance === 'none',
                'Native hue slider opts into spectrum styling');
            check(popupIsUnclipped(document.querySelector<HTMLElement>('[data-zync-color-picker-open="true"]')!), 'Shared anchored popup stays within the viewport');
            await edit('Hex color', '#abcdef');
            check(document.querySelector('[data-draft]')?.textContent === '#abcdef' && document.querySelector('[data-saved]')?.textContent === '#334455', 'Hex edits change only the draft');
            await edit('Red', '300');
            check(input('Red').getAttribute('aria-invalid') === 'true' && document.querySelector('[data-draft]')?.textContent === '#abcdef', 'Invalid RGB never emits a color');
            await edit('Red', '18'); await edit('Green', '52'); await edit('Blue', '86');
            check(document.querySelector('[data-draft]')?.textContent === '#123456', 'RGB edits produce canonical opaque hex');
            await edit('Hex color', '#000000'); await edit('Hue', '280'); await edit('Saturation', '100'); await edit('Brightness', '100');
            check(document.querySelector('[data-draft]')?.textContent === '#aa00ff', 'Hue survives black while saturation and brightness recover');
            const themeButton = dialog().querySelector<HTMLButtonElement>('[aria-label="Use Background theme color"]')!;
            themeButton.click(); await settle();
            check(document.querySelector('[data-draft]')?.textContent === '#223344', 'Theme swatches update draft only');
            const done = [...dialog().querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === 'Done')!;
            done.focus(); done.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
            check(document.activeElement === input('Hue'), 'Tab wraps inside the picker rather than the parent Modal');
            input('Hue').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
            check(document.activeElement === done, 'Shift+Tab wraps to the last picker control');
            done.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
            check(!dialog() && Boolean(document.querySelector('[data-zync-modal-surface]')) && document.activeElement === trigger(), 'Escape closes only the picker and restores its trigger');
            await open();
            const outside = document.querySelector<HTMLButtonElement>('[data-apply]')!;
            outside.focus(); await settle();
            check(!dialog() && document.activeElement === outside, 'Outside focus dismisses without stealing focus');
            await open(); flushSync(() => setDisabled(true)); await settle();
            check(!dialog(), 'Disabling the picker cancels its open popup');
            flushSync(() => setDisabled(false)); await settle();
            check(!dialog(), 'Re-enabling does not unexpectedly reopen a popup');
            check(saves.current === 0, 'Picker edits and dismissal never persist');
            outside.click(); await settle();
            check(saves.current === 1 && document.querySelector('[data-saved]')?.textContent === '#223344', 'Caller retains explicit Apply ownership');
            setResult(`Passed ${reports.length} checks\n${reports.join('\n')}`);
        } catch (error) { setResult(`FAILED: ${String(error)}\n${reports.join('\n')}`); }
        finally { setRunning(false); }
    };
    return <main className="overlay-gallery">
        <h1>Zync color picker</h1><p>Isolated draft data; no native settings or sessions.</p>
        <div className="my-3 flex gap-2 flex-wrap"><Button disabled={running} onClick={() => void run()}>Run picker checks</Button>
            <Button disabled={running} onClick={() => setLight(current => !current)}>Switch theme</Button>
            <Button onClick={() => setModalOpen(true)}>Open picker host</Button></div>
        <pre role="status" className="whitespace-pre-wrap">{result}</pre>
        <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Picker host" width="max-w-sm">
            <div className="space-y-3"><ColorPicker label="Background" value={value} disabled={disabled}
                referenceColor="#223344" palette={[{ label: 'Background', color: '#223344' }, { label: 'Text', color: '#eeeeee' }]}
                onChange={next => { drafts.current++; setValue(next); }} />
                <p>Draft: <span data-draft>{value}</span></p><p>Saved: <span data-saved>{saved}</span></p>
                <Button data-apply onClick={() => { saves.current++; setSaved(value); }}>Apply draft</Button></div>
        </Modal>
    </main>;
}
const root = createRoot(document.getElementById('root')!); root.render(<Fixture />);
import.meta.hot?.dispose(() => root.unmount());
