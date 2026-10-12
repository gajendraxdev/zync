import { useEffect, useState } from 'react';
import { THEME_PALETTE_KEYS, type ThemeDocument } from '../domain/themeDocument';
import { ELEMENT_COLOR_AREAS, ELEMENT_COLOR_DEFINITIONS, type ElementColorArea } from '../domain/elementColors';
import { ElementColorPreview } from './ElementColorPreview';
import { themeContrastWarnings, themePreviewStyle } from './themeDocumentPresentation';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Select';

interface ThemeImportPreviewProps {
    theme: ThemeDocument | null;
    saving: boolean;
    error: string | null;
    onClose(): void;
    onApply(): void;
}
/** Preview is a static sample, not a live theme switch or mounted host workspace. */
export function ThemeImportPreview({ theme, saving, error, onClose, onApply }: ThemeImportPreviewProps) {
    const [area, setArea] = useState<ElementColorArea>('mainTabs');
    useEffect(() => { setArea('mainTabs'); }, [theme]);
    const warnings = theme ? themeContrastWarnings(theme) : [];
    return <Modal isOpen={theme !== null} onClose={onClose} title="Preview imported theme" width="max-w-xl"
        explicitDismissOnly={saving} subtitle="Nothing changes until you apply.">
        {theme && <div className="space-y-4" data-zync-color-protected>
            <div><h3 className="truncate font-medium" title={theme.name}>{theme.name}</h3>
                <p className="text-xs text-app-muted">{theme.mode === 'dark' ? 'Dark' : 'Light'} · {THEME_PALETTE_KEYS.length} palette colors · {Object.keys(theme.elements.overrides).length} element overrides</p></div>
            <div style={themePreviewStyle(theme)} className="rounded-md bg-app-bg p-3 text-app-text">
                <div className="mb-3"><Select portal label="Preview area" value={area} disabled={saving}
                    options={ELEMENT_COLOR_AREAS.map(value => ({ value, label: ELEMENT_COLOR_DEFINITIONS.find(field => field.area === value)!.areaLabel }))}
                    onChange={value => { if (ELEMENT_COLOR_AREAS.includes(value as ElementColorArea)) setArea(value as ElementColorArea); }} /></div>
                <ElementColorPreview area={area} colors={theme.elements.overrides} />
            </div>
            {warnings.length > 0 && <div className="rounded-md border border-app-border p-3 text-xs" role="status">
                <p className="mb-1 font-medium">Some text may be hard to read. You can still apply this theme.</p>
                <ul className="list-disc space-y-1 pl-4">{warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
            </div>}
            <p className="text-xs text-app-muted">Replaces the app palette and global element-color overrides. Host-specific themes, fonts, transparency, layout and connections stay unchanged. Built-in themes are not edited.</p>
            {error && <p role="alert" className="text-sm text-app-danger">{error}</p>}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>Cancel</Button>
                <Button type="button" disabled={saving} onClick={onApply}>{saving ? 'Applying…' : 'Apply theme'}</Button>
            </div>
        </div>}
    </Modal>;
}
