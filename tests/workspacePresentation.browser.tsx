import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DisplayAliasDialog } from '../src/components/workspace/DisplayAliasDialog';
import { Button } from '../src/components/ui/Button';
import { Toolbar } from '../src/components/ui/Toolbar';
import { normalizeDisplayAlias } from '../src/features/workspace/domain/presentation';
import '../src/index.css';
import './uiOverlays.browser.css';

/** Presentation-only fixture: no app store, native IPC, real files or terminal sessions. */
function Gallery() {
    const [theme, setTheme] = useState<'dark' | 'light'>('dark');
    const [defaultTitle, setDefaultTitle] = useState('Example connection');
    const [displayAlias, setDisplayAlias] = useState<string>();
    const [open, setOpen] = useState(false);
    const [saves, setSaves] = useState(0);
    const [closes, setCloses] = useState(0);
    const [liveTitle, setLiveTitle] = useState(false);

    useEffect(() => {
        document.body.dataset.overlayGalleryTheme = theme;
        return () => { delete document.body.dataset.overlayGalleryTheme; };
    }, [theme]);

    useEffect(() => {
        if (!liveTitle || !open) return;
        let sequence = 0;
        const timer = window.setInterval(() => {
            sequence += 1;
            setDefaultTitle(`Live title ${sequence}`);
        }, 1_000);
        return () => window.clearInterval(timer);
    }, [liveTitle, open]);

    const close = () => { setOpen(false); setCloses(value => value + 1); };

    return (
        <main className="overlay-gallery">
            <h1>Workspace display names</h1>
            <p>Development fixture only. Renaming changes this sample label, never a host, file, session or setting.</p>
            <Toolbar label="Fixture controls" className="my-6">
                <Button type="button" variant="secondary" onClick={() => setTheme(value => value === 'dark' ? 'light' : 'dark')}>
                    Use {theme === 'dark' ? 'light' : 'dark'} theme
                </Button>
                <Button type="button" variant="secondary" aria-pressed={liveTitle} onClick={() => setLiveTitle(value => !value)}>
                    {liveTitle ? 'Disable' : 'Enable'} live default title
                </Button>
            </Toolbar>
            <section className="max-w-xl">
                <h2>Sample workspace tab</h2>
                <output data-testid="display-title" className="block truncate font-semibold">
                    {normalizeDisplayAlias(displayAlias) ?? defaultTitle}
                </output>
                <Button type="button" onClick={() => setOpen(true)}>Rename sample tab</Button>
                <output aria-live="polite">Saves: {saves}; closes: {closes}; alias: {displayAlias === undefined ? 'default' : displayAlias}</output>
                <p>Check Save/Enter once, Cancel/Escape unchanged, Reset, 80/81 characters, Unicode and reopening. Enable the live title before opening to confirm draft preservation while the default changes.</p>
            </section>
            <DisplayAliasDialog
                isOpen={open}
                defaultTitle={defaultTitle}
                displayAlias={displayAlias}
                onSave={(alias) => { setDisplayAlias(alias); setSaves(value => value + 1); }}
                onClose={close}
            />
        </main>
    );
}

createRoot(document.getElementById('root')!).render(<Gallery />);
