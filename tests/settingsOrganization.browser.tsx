import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { SettingsNavigation, settingsPanelId, settingsTabId, type SettingsSection } from '../src/components/settings/SettingsNavigation';
import { AppearanceTab } from '../src/components/settings/tabs/AppearanceTab';
import { LayoutNavigationTab } from '../src/components/settings/tabs/LayoutNavigationTab';
import { TerminalAppearanceSection } from '../src/components/settings/tabs/terminal/TerminalAppearanceSection';
import { TerminalTabIntro } from '../src/components/settings/tabs/TerminalTabIntro';
import { useAppStore } from '../src/store/useAppStore';
import type { AppSettings } from '../src/store/settingsSlice';
import { changeChromeActions, parseChromeActions } from '../src/features/workspace/domain/chromeActions';
import { changeWorkspaceNavigation, resolveWorkspaceNavigation } from '../src/features/workspace/domain/navigation';
import { changeElementColors, parseElementColors } from '../src/features/appearance/domain/elementColors';
import { Button } from '../src/components/ui/Button';
import '../src/index.css';
import './uiOverlays.browser.css';

// Test-only ports: exercise production pages with acknowledged in-memory writes, never native settings.
const initial = structuredClone(useAppStore.getState().settings);
const writes: Partial<AppSettings>[] = [];
const publish = async (patch: Partial<AppSettings>) => {
    writes.push(patch); useAppStore.setState(state => ({ settings: { ...state.settings, ...patch } }));
};
useAppStore.setState({ settings: initial, isLoadingSettings: false, isReloadingSettings: false,
    updateWorkspaceNavigation: async change => {
        await publish({ workspaceNavigation: changeWorkspaceNavigation(resolveWorkspaceNavigation(useAppStore.getState().settings.workspaceNavigation), change) });
    },
    updateChromeActions: async change => {
        await publish({ chromeActions: changeChromeActions(parseChromeActions(useAppStore.getState().settings.chromeActions)!, change)! });
    },
    updateElementColors: async change => {
        await publish({ elementColors: changeElementColors(parseElementColors(useAppStore.getState().settings.elementColors)!, change)! });
    },
});
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const updateTerminalSettings = async (patch: Partial<AppSettings['terminal']>) => {
    await publish({ terminal: { ...useAppStore.getState().settings.terminal, ...patch } });
};
const updateStatusBarSettings = async (patch: Partial<AppSettings['statusBar']>) => {
    await publish({ statusBar: { ...useAppStore.getState().settings.statusBar, ...patch } });
};

function Fixture() {
    const settings = useAppStore(state => state.settings);
    const [tab, setTab] = useState<SettingsSection>('layout');
    const [globalFontDraft, setGlobalFontDraft] = useState(settings.globalFontFamily ?? '');
    const [terminalFontDraft, setTerminalFontDraft] = useState(settings.terminal.fontFamily);
    const [light, setLight] = useState(false);
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState('Ready');
    useEffect(() => {
        document.body.dataset.overlayGalleryTheme = light ? 'light' : 'dark';
        document.body.dataset.theme = light ? 'light' : 'dark';
    }, [light]);
    const run = async () => {
        setRunning(true); const reports: string[] = [];
        const check = (condition: boolean, label: string) => reports.push(`${condition ? 'PASS' : 'FAIL'} ${label}`);
        const content = () => document.getElementById(settingsPanelId('organization'))!;
        const switchTo = async (section: SettingsSection) => { setTab(section); await settle(); };
        try {
            const before = writes.length;
            await switchTo('appearance');
            check(!!content().querySelector('[aria-label="Edit Background color"]') && !content().querySelector('[data-chrome-customization]'), 'Appearance owns colors, not chrome actions');
            check(!content().querySelector('#terminal-opacity-slider') && !content().querySelector('[aria-label="Appearance scope"]'), 'No duplicate terminal controls or scope switch in Appearance');
            await switchTo('layout');
            check(!!content().querySelector('[data-chrome-customization="workspaceToolbar"]') && !!content().querySelector('[data-chrome-customization="statusBar"]'), 'Toolbar and status controls share Layout & Navigation');
            const latency = content().querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Show connection latency"]')!;
            const oldLatency = useAppStore.getState().settings.statusBar.showConnectionLatency;
            latency.click(); await settle();
            check(useAppStore.getState().settings.statusBar.showConnectionLatency !== oldLatency && writes.at(-1)?.statusBar !== undefined, 'Latency uses its existing statusBar field');
            await switchTo('terminal');
            check(!!content().querySelector('#terminal-custom-font-stack-input') && !!content().querySelector('#terminal-opacity-slider'), 'Terminal owns font and viewport controls');
            check(writes.length === before + 1, 'Navigating pages does not save or reset settings');
            const slider = content().querySelector<HTMLInputElement>('#terminal-opacity-slider')!;
            const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            const next = slider.value === '67' ? '68' : '67';
            nativeSetter.call(slider, next); slider.dispatchEvent(new Event('input', { bubbles: true })); await settle();
            check(writes.length === before + 1, 'Opacity movement remains a local draft');
            slider.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
            slider.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true })); await settle();
            check(writes.length === before + 2 && useAppStore.getState().settings.windowOpacity === Number(next) / 100, 'Opacity commits once on release/key boundary');
            const targetCursor = useAppStore.getState().settings.terminal.cursorStyle === 'bar' ? 'underline' : 'bar';
            content().querySelector<HTMLButtonElement>(`button[aria-label="${targetCursor} cursor"]`)!.click(); await settle();
            check(useAppStore.getState().settings.terminal.cursorStyle === targetCursor, 'Cursor retains its terminal field');
            await switchTo('appearance'); await switchTo('terminal');
            check(content().querySelector<HTMLInputElement>('#terminal-opacity-slider')!.value === next, 'Acknowledged opacity survives page remount');
            content().querySelector<HTMLButtonElement>('button')!.click(); await settle();
            check(!!content().querySelector('[aria-label="Edit Background color"]'), 'Terminal theme link opens the single Appearance editor');
            await switchTo('layout');
            check(content().scrollWidth <= content().clientWidth + 1, 'Layout controls fit without horizontal overflow');
        } catch (error) { reports.push(`FAIL ${String(error)}`); }
        finally { setResult(reports.join('\n')); setRunning(false); }
    };
    return <main className="h-full overflow-auto bg-app-bg p-4 text-app-text">
        <h1 className="text-lg font-semibold">Settings organization</h1>
        <p className="my-2 text-sm">Production pages with memory-only settings. No native saves or sessions.</p>
        <div className="mb-3 flex gap-2"><Button disabled={running} onClick={() => void run()}>Run organization checks</Button>
            <Button disabled={running} variant="secondary" onClick={() => setLight(value => !value)}>Switch theme</Button></div>
        <div className="flex h-[520px] max-w-4xl overflow-hidden rounded border border-app-border bg-app-panel">
            <SettingsNavigation idPrefix="organization" activeTab={tab} onTabChange={setTab} onOpenJson={() => {}} />
            <div role="tabpanel" id={settingsPanelId('organization')} aria-labelledby={settingsTabId('organization', tab)} className="min-w-0 flex-1 overflow-y-auto p-4 space-y-6">
                {tab === 'appearance' && <AppearanceTab settings={settings} plugins={[]} globalFontDraft={globalFontDraft} setGlobalFontDraft={setGlobalFontDraft} updateSettings={publish} />}
                {tab === 'layout' && <LayoutNavigationTab settings={settings} updateSettings={publish} updateStatusBarSettings={updateStatusBarSettings} />}
                {tab === 'terminal' && <><TerminalTabIntro onOpenAppearance={() => setTab('appearance')} />
                    <TerminalAppearanceSection settings={settings} isWindows={false} terminalFontDraft={terminalFontDraft} setTerminalFontDraft={setTerminalFontDraft} updateSettings={publish} updateTerminalSettings={updateTerminalSettings} /></>}
                {!['appearance', 'layout', 'terminal'].includes(tab) && <p>Other settings are outside this fixture.</p>}
            </div>
        </div>
        <pre role="status" aria-label="Organization results" className="mt-3 whitespace-pre-wrap text-xs">{result}</pre>
    </main>;
}
const root = createRoot(document.querySelector('#root')!); root.render(<TooltipProvider delayDuration={120}><Fixture /></TooltipProvider>);
import.meta.hot?.dispose(() => root.unmount());
