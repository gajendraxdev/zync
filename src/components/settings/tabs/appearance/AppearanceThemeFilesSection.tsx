import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '../../../../store/settingsSlice';
import { resolveZyncThemeMode } from '../../../../lib/themePayload';
import { themeFiles, type ThemeFilePort } from '../../../../features/appearance/application/themeFiles';
import { CUSTOM_THEME_ID, parseThemeDocument, type ThemeDocument } from '../../../../features/appearance/domain/themeDocument';
import { captureThemeDocument } from '../../../../features/appearance/presentation/themeDocumentPresentation';
import { ThemeImportPreview } from '../../../../features/appearance/presentation/ThemeImportPreview';
import { ThemeKeyReference } from '../../../../features/appearance/presentation/ThemeKeyReference';
import { Button } from '../../../ui/Button';
import { Tooltip } from '../../../ui/Tooltip';
import { Section } from '../../common/Section';

interface AppearanceThemeFilesSectionProps {
    settings: AppSettings;
    loading: boolean;
    onImport(theme: ThemeDocument): Promise<void>;
    onSelectTheme(id: string): void;
    /** File selection is separate from preview/apply; fixtures can supply an in-memory port. */
    files?: ThemeFilePort;
}

export function AppearanceThemeFilesSection({ settings, loading, onImport, onSelectTheme, files = themeFiles }: AppearanceThemeFilesSectionProps) {
    const custom = parseThemeDocument(settings.customTheme);
    const [preview, setPreview] = useState<ThemeDocument | null>(null);
    const [referenceOpen, setReferenceOpen] = useState(false);
    const [busy, setBusy] = useState<'file' | 'apply' | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState('');
    const pending = useRef(false);
    const alive = useRef(true);
    const importButton = useRef<HTMLButtonElement>(null);
    const hadPreview = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    useEffect(() => {
        if (preview) { hadPreview.current = true; return; }
        if (!hadPreview.current || busy !== null) return;
        hadPreview.current = false;
        // File selection can blur the disabled trigger before the nested modal captures it.
        // Restore to the stable import action after Apply/Cancel and re-enabling controls.
        const frame = requestAnimationFrame(() => importButton.current?.focus({ preventScroll: true }));
        return () => cancelAnimationFrame(frame);
    }, [preview, busy]);
    const run = async (operation: 'file' | 'apply', action: () => Promise<void>) => {
        if (pending.current || loading) return;
        pending.current = true; setBusy(operation); setError(null); setMessage('');
        try { await action(); }
        catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : String(failure)); }
        finally { pending.current = false; if (alive.current) setBusy(null); }
    };
    const exportCurrentTheme = () => { void run('file', async () => {
        const theme = captureThemeDocument(document, resolveZyncThemeMode(), settings.elementColors,
            settings.theme === CUSTOM_THEME_ID && custom ? custom.name : 'My Zync theme');
        const exported = await files.export(theme);
        if (alive.current && exported) setMessage('Theme exported. Edit the JSON colors and import it to preview.');
    }); };
    const pickTheme = () => { void run('file', async () => {
        const theme = await files.pick();
        if (alive.current && theme) setPreview(theme);
    }); };
    return <Section title="Theme files">
        <div className="space-y-3">
            <p className="text-xs text-app-muted">Export your current colors, edit the JSON, then import to preview. Version 1 supports opaque hex colors, not images, gradients or executable theme plugins.</p>
            <div className="flex flex-wrap gap-2">
                <Tooltip content="Save the current palette and saved element overrides as a JSON file." contentClassName="max-w-xs whitespace-normal" disabledTrigger={loading || busy !== null}>
                    <Button type="button" variant="secondary" className="h-auto min-h-[var(--zync-control-height-md)] whitespace-normal"
                        disabled={loading || busy !== null} onClick={exportCurrentTheme}>Export theme JSON</Button>
                </Tooltip>
                <Tooltip content="Validate a theme file and preview it before applying any changes." contentClassName="max-w-xs whitespace-normal" disabledTrigger={loading || busy !== null}>
                    <Button ref={importButton} type="button" variant="secondary" className="h-auto min-h-[var(--zync-control-height-md)] whitespace-normal"
                        disabled={loading || busy !== null} onClick={pickTheme}>Import theme JSON</Button>
                </Tooltip>
                <Tooltip content="See every supported palette and override key, with a copyable example." contentClassName="max-w-xs whitespace-normal" disabledTrigger={loading || busy !== null}>
                    <Button type="button" variant="secondary" className="h-auto min-h-[var(--zync-control-height-md)] whitespace-normal" disabled={loading || busy !== null}
                        onClick={() => setReferenceOpen(true)}>View theme keys</Button>
                </Tooltip>
            </div>
            {custom && <button type="button" disabled={loading || busy !== null} aria-pressed={settings.theme === CUSTOM_THEME_ID}
                onClick={() => onSelectTheme(CUSTOM_THEME_ID)} className="flex w-full min-w-0 items-center gap-3 rounded-md border border-app-border p-3 text-left hover:bg-app-surface">
                <span className="h-8 w-8 shrink-0 rounded border" style={{ backgroundColor: custom.palette.background, borderColor: custom.palette.accent }} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{custom.name}</span>
                    <span className="block text-xs text-app-muted">Imported palette · {custom.mode}</span></span>
                {settings.theme === CUSTOM_THEME_ID && <span className="text-xs text-app-muted">Active</span>}
            </button>}
            {settings.customTheme !== undefined && !custom && <p className="text-xs text-app-muted">The saved custom theme uses an unsupported format. It is preserved and will not be replaced by import.</p>}
            {error && !preview && <p role="alert" className="text-sm text-app-danger">{error}</p>}
            <p role="status" className="text-xs text-app-muted">{message || (busy === 'file' ? 'Reading or saving theme…' : '')}</p>
            <ThemeKeyReference open={referenceOpen} onClose={() => setReferenceOpen(false)} />
            <ThemeImportPreview theme={preview} saving={busy === 'apply'} error={error}
                onClose={() => { if (!pending.current) { setPreview(null); setError(null); } }}
                onApply={() => { if (preview) void run('apply', async () => {
                    await onImport(preview);
                    if (alive.current) { setPreview(null); setMessage('Theme applied.'); }
                }); }} />
        </div>
    </Section>;
}
