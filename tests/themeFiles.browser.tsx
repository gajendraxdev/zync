import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider as TooltipProvider } from '@radix-ui/react-tooltip';
import { AppearanceElementColorsSection } from '../src/components/settings/tabs/appearance/AppearanceElementColorsSection';
import { changeElementColors, parseElementColors } from '../src/features/appearance/domain/elementColors';
import { AppearanceThemeFilesSection } from '../src/components/settings/tabs/appearance/AppearanceThemeFilesSection';
import { AppearanceAccentSection } from '../src/components/settings/tabs/appearance/AppearanceAccentSection';
import { Modal } from '../src/components/ui/Modal';
import { useCustomThemeStyle } from '../src/features/appearance/presentation/useCustomThemeStyle';
import { useElementColorStyle } from '../src/features/appearance/presentation/useElementColorStyle';
import { ElementColorPreview } from '../src/features/appearance/presentation/ElementColorPreview';
import { readThemeJson, parseThemeDocument, writeThemeJson, type ThemeDocument } from '../src/features/appearance/domain/themeDocument';
import { useAppStore } from '../src/store/useAppStore';
import { Button } from '../src/components/ui/Button';
import fixture from './fixtures/themeDocument.json';
import '../src/index.css';
import './uiOverlays.browser.css';

const refresh = () => {};
const initial = structuredClone(useAppStore.getState().settings);
function Fixture() {
    const [settings, setSettings] = useState(initial);
    const [variant, setVariant] = useState('dark');
    const [reject, setReject] = useState(false);
    const [writes, setWrites] = useState(0);
    const [exports, setExports] = useState('');
    const [width, setWidth] = useState('full');
    const [shellOpen, setShellOpen] = useState(false);
    const [accentDraft, setAccentDraft] = useState('#797bce');
    useCustomThemeStyle(settings.theme, settings.customTheme);
    useElementColorStyle(settings.elementColors, refresh);
    useEffect(() => {
        document.body.dataset.overlayGalleryTheme = settings.theme === 'light' ? 'light' : 'dark';
        document.body.dataset.theme = settings.theme;
        useAppStore.setState({ settings, isLoadingSettings: false, isReloadingSettings: false });
    }, [settings]);
    const file = () => {
        if (variant === 'invalid') return readThemeJson('{broken');
        const theme = structuredClone(fixture.theme);
        if (variant === 'light') {
            theme.mode = 'light'; theme.name = 'Ocean light';
            theme.palette = { background: '#f4f6fa', panel: '#ffffff', surface: '#e5ebf3', border: '#9bacc3', text: '#172033', muted: '#475569', accent: '#2563eb' };
        }
        if (variant === 'low') { theme.palette.text = theme.palette.background; theme.name = 'Low contrast sample'; }
        return readThemeJson(JSON.stringify(theme));
    };
    const filesSection = <AppearanceThemeFilesSection settings={settings} loading={false} onSelectTheme={theme => setSettings(state => ({ ...state, theme, accentColor: null }))}
        files={{ pick: async () => file(), export: async theme => { setExports(writeThemeJson(theme)); return true; } }}
        onImport={async (theme: ThemeDocument) => {
            if (reject) throw new Error('Test save refused. No colors changed.');
            setSettings(state => ({ ...state, theme: 'custom', customTheme: theme, accentColor: null, elementColors: theme.elements }));
            setWrites(count => count + 1);
        }} />;
    return <main className="h-screen overflow-auto bg-app-bg p-6 text-app-text">
        <div className="mx-auto max-w-2xl space-y-6">
            <h1 className="text-xl font-semibold">Theme JSON import/export fixture</h1>
            <p className="text-xs text-app-muted">Test-only file and save ports. No native files, credentials or saved settings are touched.</p>
            <div className="flex flex-wrap items-center gap-3 text-xs">
                <label>Test file <select aria-label="Test file" className="bg-app-surface" value={variant} onChange={event => setVariant(event.target.value)}>
                    <option value="dark">Dark</option><option value="light">Light</option><option value="invalid">Invalid JSON</option><option value="low">Low contrast</option>
                </select></label>
                <label><input type="checkbox" checked={reject} onChange={event => setReject(event.target.checked)} /> Reject save</label>
                <Button variant="secondary" onClick={() => setSettings(state => ({ ...state, theme: 'light', accentColor: null }))}>Switch to built-in Light</Button>
                <Button variant="secondary" onClick={() => setShellOpen(true)}>Open Settings shell</Button>
                <output aria-label="Confirmed saves">Confirmed saves: {writes}</output>
                <output aria-label="Active theme">Active theme: {settings.theme}</output>
                <label>Section width <select aria-label="Section width" className="bg-app-surface" value={width} onChange={event => setWidth(event.target.value)}>
                    <option value="full">Full</option><option value="240">240 px</option><option value="320">320 px</option>
                </select></label>
            </div>
            <div className="max-w-full space-y-6" style={{ width: width === 'full' ? '100%' : `${width}px` }}>
            <AppearanceAccentSection settings={settings} themeAccent="#797bce" tempAccentColor={accentDraft}
                onTempAccentColorChange={setAccentDraft} onSelectPresetAccent={accentColor => { setSettings(state => ({ ...state, accentColor })); setWrites(count => count + 1); }}
                onCommitAccentColor={() => { setSettings(state => ({ ...state, accentColor: accentDraft })); setWrites(count => count + 1); }} />
            <AppearanceElementColorsSection value={settings.elementColors} active onChange={async change => {
                setSettings(state => ({ ...state, elementColors: changeElementColors(parseElementColors(state.elementColors)!, change) }));
                setWrites(count => count + 1);
            }} />
            {filesSection}
            </div>
            <ElementColorPreview area="mainTabs" colors={parseThemeDocument(settings.customTheme)?.elements.overrides ?? {}} />
            {exports && <details><summary>Exported JSON</summary><pre aria-label="Exported JSON" className="overflow-auto text-xs">{exports}</pre></details>}
        </div>
        <Modal isOpen={shellOpen} onClose={() => setShellOpen(false)} title="Settings shell" width="max-w-2xl">
            <p className="mb-4 text-xs text-app-muted">Nested-dialog check. Escape should close only the focused dialog.</p>
            {filesSection}
        </Modal>
    </main>;
}
const root = createRoot(document.getElementById('root')!);
root.render(<TooltipProvider delayDuration={120}><Fixture /></TooltipProvider>);
import.meta.hot?.dispose(() => root.unmount());
