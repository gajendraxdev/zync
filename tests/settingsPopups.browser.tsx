import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { NavigationSection } from '../src/components/settings/tabs/layout/NavigationSection';
import { AppearanceElementColorsSection } from '../src/components/settings/tabs/appearance/AppearanceElementColorsSection';
import { changeWorkspaceNavigation, DEFAULT_WORKSPACE_NAVIGATION, type NavigationChange } from '../src/features/workspace/domain/navigation';
import { changeElementColors, parseElementColors, type ElementColorChange } from '../src/features/appearance/domain/elementColors';
import { Button } from '../src/components/ui/Button';
import { popupIsUnclipped } from './helpers/popupVisibility.browser';
import '../src/index.css';
import './uiOverlays.browser.css';

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const finishAnimation = () => new Promise(resolve => setTimeout(resolve, 200));

/** Production sections inside a constrained scroller; writes acknowledge in memory only. */
function Fixture() {
    const [navigation, setNavigation] = useState(DEFAULT_WORKSPACE_NAVIGATION);
    const [colors, setColors] = useState<unknown>();
    const [light, setLight] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState('Ready');
    const saves = useRef(0);
    useEffect(() => {
        const theme = light ? 'light' : 'dark';
        document.body.dataset.overlayGalleryTheme = theme;
        document.body.dataset.theme = theme;
    }, [light]);
    const saveNavigation = async (change: NavigationChange) => {
        saves.current++; setNavigation(current => changeWorkspaceNavigation(current, change));
    };
    const saveColors = async (change: ElementColorChange) => {
        saves.current++; setColors((current: unknown) => changeElementColors(parseElementColors(current)!, change));
    };
    const run = async () => {
        setRunning(true); setResult('Running');
        const reports: string[] = [];
        const before = saves.current;
        try {
            for (const label of ['Navigation position', 'Interface area']) {
                const fieldLabel = [...document.querySelectorAll<HTMLLabelElement>('label')].find(node => node.textContent === label)!;
                const trigger = document.getElementById(fieldLabel.htmlFor) as HTMLButtonElement;
                trigger.scrollIntoView({ block: 'center' }); await settle();
                trigger.click(); await settle(); await finishAnimation();
                const popup = document.querySelector<HTMLElement>('[data-zync-select-open="true"]');
                reports.push(`${popup && popupIsUnclipped(popup) ? 'PASS' : 'FAIL'} ${label}: menu is not clipped`);
                document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
                await settle(); await finishAnimation();
                reports.push(`${!document.querySelector('[data-zync-select-open="true"]') && document.activeElement === trigger ? 'PASS' : 'FAIL'} ${label}: Escape restores trigger`);
            }
            const colorTrigger = document.querySelector<HTMLButtonElement>('button[aria-label="Edit Background color"]')!;
            colorTrigger.scrollIntoView({ block: 'center' }); await settle(); colorTrigger.click(); await settle();
            const picker = document.querySelector<HTMLElement>('[data-zync-color-picker-open="true"]');
            reports.push(`${picker && popupIsUnclipped(picker) ? 'PASS' : 'FAIL'} Color picker: popup is not clipped`);
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await settle();
            reports.push(`${!document.querySelector('[data-zync-color-picker-open="true"]') && document.activeElement === colorTrigger ? 'PASS' : 'FAIL'} Color picker: Escape restores trigger`);
            const preview = document.querySelector<HTMLElement>('[role="img"][aria-label^="Area preview:"]')!;
            const scroller = document.querySelector<HTMLElement>('[aria-label="Scrollable Settings preview"]')!;
            reports.push(`${preview.scrollWidth <= preview.clientWidth + 1 && preview.getBoundingClientRect().width <= scroller.clientWidth ? 'PASS' : 'FAIL'} Sample workspace fits the narrow Settings panel`);
            reports.push(`${!preview.querySelector('button, input, select, textarea, a, iframe, canvas, [tabindex]') ? 'PASS' : 'FAIL'} Sample workspace has no live or focusable imitation controls`);
            reports.push(`${saves.current === before ? 'PASS' : 'FAIL'} Opening and dismissing menus does not save settings`);
        } catch (error) {
            reports.push(`FAIL ${String(error)}`);
        } finally {
            setResult(reports.join('\n')); setRunning(false);
        }
    };
    return <main className="h-full overflow-auto bg-app-bg p-4 text-app-text">
        <h1 className="text-lg font-semibold">Scrolling Settings popups</h1>
        <p className="my-3 text-sm">Real controls, constrained scrolling preview. No native settings, connections or sessions.</p>
        <div className="mb-3 flex flex-wrap gap-2">
            <Button disabled={running} onClick={() => void run()}>Run popup checks</Button>
            <Button variant="secondary" disabled={running} onClick={() => setLight(value => !value)}>Switch theme</Button>
        </div>
        <div aria-label="Scrollable Settings preview" className="h-64 w-80 max-w-full overflow-y-auto rounded border border-app-border bg-app-panel p-4">
            <NavigationSection value={navigation} onChange={saveNavigation} />
            <AppearanceElementColorsSection value={colors} active onChange={saveColors} />
        </div>
        <pre role="status" aria-label="Popup check results" className="mt-3 whitespace-pre-wrap text-sm">{result}</pre>
    </main>;
}
const root = createRoot(document.querySelector('#root')!);
root.render(<TooltipProvider delayDuration={120}><Fixture /></TooltipProvider>);
import.meta.hot?.dispose(() => root.unmount());
