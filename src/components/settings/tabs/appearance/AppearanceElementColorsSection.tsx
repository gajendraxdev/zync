import { useEffect, useId, useRef, useState } from 'react';
import { ELEMENT_COLOR_AREAS, ELEMENT_COLOR_DEFINITIONS, normalizeElementColor, parseElementColors,
    type ElementColorArea, type ElementColorChange, type ElementColorKey } from '../../../../features/appearance/domain/elementColors';
import { colorContrast } from '../../../../features/appearance/domain/colorContrast';
import { useElementColorSamples } from '../../../../features/appearance/presentation/useElementColorSamples';
import { ElementColorPreview } from '../../../../features/appearance/presentation/ElementColorPreview';
import { elementContrastPair } from '../../../../features/appearance/presentation/elementColorContrast';
import { Section } from '../../common/Section';
import { Button } from '../../../ui/Button';
import { Input } from '../../../ui/Input';
import { Select } from '../../../ui/Select';
import { ColorPicker } from '../../../ui/ColorPicker';
import { Tooltip } from '../../../ui/Tooltip';

export interface AppearanceElementColorsSectionProps {
    value: unknown;
    active: boolean;
    loading?: boolean;
    onChange: (change: ElementColorChange) => Promise<void>;
}

/** Explicit-apply semantic colors; drafts never alter the live app or persist per keystroke. */
export function AppearanceElementColorsSection({ value, active, loading = false, onChange }: AppearanceElementColorsSectionProps) {
    const parsed = parseElementColors(value);
    const [key, setKey] = useState<ElementColorKey>('mainTabs.background');
    const [drafts, setDrafts] = useState<Partial<Record<ElementColorKey, string>>>({});
    const [confirmation, setConfirmation] = useState<'area' | 'all' | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState('');
    const pending = useRef(false);
    const alive = useRef(true);
    const frame = useRef(0);
    const root = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const hintId = useId();
    const definition = ELEMENT_COLOR_DEFINITIONS.find(entry => entry.key === key)!;
    const fields = ELEMENT_COLOR_DEFINITIONS.filter(entry => entry.area === definition.area);
    const samples = useElementColorSamples(active, value);
    const saved = parsed?.overrides[key];
    const draft = drafts[key] ?? saved ?? '';
    const color = normalizeElementColor(draft.trim());
    const disabled = !parsed || loading || saving;
    const palette = fields.flatMap(entry => samples[entry.key] ? [{ label: entry.label, color: samples[entry.key]! }] : []);
    const previewColors: Partial<Record<ElementColorKey, string | null>> = Object.fromEntries(ELEMENT_COLOR_DEFINITIONS.map(entry => [entry.key,
        normalizeElementColor(drafts[entry.key]?.trim()) ?? parsed?.overrides[entry.key] ?? samples[entry.key] ?? null]));
    const effective = (item: ElementColorKey): string | null => previewColors[item] ?? null;
    const pair = elementContrastPair(key);
    const isBoundary = key.endsWith('.border') || key === 'terminal.cursor';
    const ratio = colorContrast(effective(pair.foreground), effective(pair.background));
    const minimum = pair.minimum;

    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; cancelAnimationFrame(frame.current); };
    }, []);

    const apply = async (change: ElementColorChange) => {
        if (disabled || pending.current) return;
        pending.current = true;
        const focused = document.activeElement;
        const ownedFocus = root.current?.contains(focused);
        setSaving(true); setError(null); setMessage('');
        try {
            await onChange(change);
            if (!alive.current) return;
            setDrafts(current => {
                const next = { ...current };
                for (const entry of ELEMENT_COLOR_DEFINITIONS) {
                    if (change.type === 'reset-all' || (change.type === 'reset-area' ? entry.area === change.area : entry.key === change.key)) delete next[entry.key];
                }
                return next;
            });
            setConfirmation(null);
            setMessage(change.type === 'set' ? 'Color saved.' : 'Theme colors restored.');
        } catch {
            if (alive.current) setError('The change could not be confirmed. Your draft is kept. Retry the same change, or reload settings before making a different change.');
        } finally {
            pending.current = false;
            if (alive.current) {
                setSaving(false);
                cancelAnimationFrame(frame.current);
                frame.current = requestAnimationFrame(() => {
                    if (!alive.current || !ownedFocus || !document.hasFocus()
                        || (document.activeElement !== document.body && document.activeElement !== focused)) return;
                    // Pending native writes may blur disabled buttons. Never steal focus from another control/dialog.
                    const target = focused instanceof HTMLElement && focused.isConnected ? focused : input.current;
                    if (target && root.current?.contains(target) && target.getClientRects().length) target.focus();
                });
            }
        }
    };
    const selectKey = (next: ElementColorKey) => { setKey(next); setConfirmation(null); setMessage(''); };
    const setDraft = (text: string) => { setDrafts(current => ({ ...current, [key]: text })); setMessage(''); };

    return <Section title="Element colors">
        <div ref={root} data-zync-color-protected aria-busy={saving} className="space-y-3">
            <p id={hintId} className="text-xs text-app-muted">Customize global interface colors across all hosts without changing your theme. Unset colors follow the theme. Dialogs, error indicators, focus rings and plugin content keep their own colors.</p>
            {!parsed && <p role="alert" className="text-sm text-control-danger">Element colors use an unsupported format. They are preserved; review settings.json before editing.</p>}
            <div>
                <Select portal label="Interface area" value={definition.area} disabled={disabled}
                    options={ELEMENT_COLOR_AREAS.map(area => ({ value: area, label: ELEMENT_COLOR_DEFINITIONS.find(entry => entry.area === area)!.areaLabel }))}
                    onChange={area => {
                        const first = ELEMENT_COLOR_DEFINITIONS.find(entry => entry.area === area as ElementColorArea);
                        if (first) selectKey(first.key);
                    }} />
            </div>
            <ul aria-label={`${definition.areaLabel} color roles`} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {fields.map(field => {
                    const savedColor = parsed?.overrides[field.key];
                    const fieldDraft = drafts[field.key] ?? savedColor ?? '';
                    const isDraft = drafts[field.key] !== undefined && fieldDraft !== (savedColor ?? '');
                    return <li key={field.key}>
                        <ColorPicker label={field.label} value={fieldDraft} referenceColor={samples[field.key]} disabled={disabled}
                            onOpen={() => selectKey(field.key)}
                            onChange={text => { setDrafts(current => ({ ...current, [field.key]: text })); setMessage(''); }}
                            palette={palette}
                            className={`h-auto min-h-14 w-full justify-start gap-3 px-3 py-2 text-left ${key === field.key ? 'border-app-accent/60' : ''}`}>
                            <span aria-hidden="true" className="h-7 w-7 shrink-0 rounded border border-app-border" style={{ backgroundColor: effective(field.key) ?? undefined }} />
                            <span className="min-w-0 flex-1"><span className="block text-sm">{field.label}</span>
                                <span className="block text-xs font-normal text-app-muted">{isDraft ? 'Unsaved' : savedColor ? 'Customized' : 'Following theme'}</span></span>
                        </ColorPicker>
                    </li>;
                })}
            </ul>
            <p className="text-xs text-app-muted">Editing {definition.label.toLowerCase()}. Changes stay in the preview until you apply this color.</p>
            <details>
                <summary className="cursor-pointer text-xs text-app-muted">Hex value · {saved ? `Saved ${saved}` : 'Following theme'}</summary>
                <div className="mt-2"><Input ref={input} label="Hex color" value={draft} placeholder="#RRGGBB"
                    disabled={disabled} spellCheck={false} autoComplete="off" maxLength={7} aria-describedby={hintId}
                    error={draft && !color ? 'Enter a six-digit hex color, for example #334455.' : undefined}
                    onChange={event => setDraft(event.target.value)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                            event.preventDefault(); event.stopPropagation();
                            if (color) void apply({ type: 'set', key, color });
                        }
                    }} /></div>
            </details>
            <ElementColorPreview area={definition.area} colors={previewColors} />
            <p className="text-xs text-app-muted">Sample workspace only—not interactive. It shows your saved colors and unsaved drafts using theme references. Transparency, connection presets and plugin content can differ; check the actual interface before keeping a color.</p>
            <p role="status" className={ratio !== null && ratio < minimum ? 'text-xs text-control-danger' : 'text-xs text-app-muted'}>
                {ratio === null ? 'Contrast cannot be measured for this reference. Check the actual interface before keeping this color.'
                    : `${ratio.toFixed(2)}:1 ${isBoundary ? 'boundary' : 'text'} contrast${ratio < minimum ? ` — below the ${minimum}:1 target. Choose a more distinct pair.` : ` for this pair (target ${minimum}:1).`}`}
            </p>
            {definition.area === 'terminal' && <p className="text-xs text-app-muted">These are terminal defaults. Connection color presets take precedence; ANSI colors and transparency settings remain unchanged.</p>}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Element color actions">
                <Tooltip content={`Save the draft ${definition.label.toLowerCase()} color for ${definition.areaLabel.toLowerCase()}.`} contentClassName="max-w-xs whitespace-normal" disabledTrigger={disabled || !color}>
                    <Button type="button" size="sm" className="h-auto min-h-[var(--zync-control-height-sm)] whitespace-normal py-1.5" disabled={disabled || !color} onClick={() => { if (color) void apply({ type: 'set', key, color }); }}>Apply color</Button>
                </Tooltip>
                <Tooltip content={`Remove the ${definition.label.toLowerCase()} override for ${definition.areaLabel.toLowerCase()} and follow the theme again.`} contentClassName="max-w-xs whitespace-normal" disabledTrigger={disabled}>
                    <Button type="button" size="sm" variant="secondary" className="h-auto min-h-[var(--zync-control-height-sm)] whitespace-normal py-1.5" disabled={disabled} onClick={() => { void apply({ type: 'reset', key }); }}>Use theme color</Button>
                </Tooltip>
                <Tooltip content={`Review a reset of all ${definition.areaLabel.toLowerCase()} color overrides. Other areas stay unchanged.`} contentClassName="max-w-xs whitespace-normal" disabledTrigger={disabled}>
                    <Button type="button" size="sm" variant="secondary" className="h-auto min-h-[var(--zync-control-height-sm)] whitespace-normal py-1.5" disabled={disabled} onClick={() => setConfirmation('area')}>Reset area</Button>
                </Tooltip>
                <Tooltip content="Review a reset of every element color override. Theme, accent and other settings stay unchanged." contentClassName="max-w-xs whitespace-normal" disabledTrigger={disabled}>
                    <Button type="button" size="sm" variant="secondary" className="h-auto min-h-[var(--zync-control-height-sm)] whitespace-normal py-1.5" disabled={disabled} onClick={() => setConfirmation('all')}>Reset all colors</Button>
                </Tooltip>
            </div>
            {confirmation && <div role="group" aria-label="Confirm color reset" className="space-y-2 rounded-md border border-app-border p-3">
                <p className="text-sm">{confirmation === 'all' ? 'Remove all element color overrides?' : `Restore all ${definition.areaLabel.toLowerCase()} colors?`} Theme, accent and other settings will not change.</p>
                <div className="flex gap-2">
                    <Button type="button" size="sm" variant="secondary" disabled={disabled} onClick={() => setConfirmation(null)}>Cancel</Button>
                    <Button type="button" size="sm" disabled={disabled} onClick={() => { void apply(confirmation === 'all' ? { type: 'reset-all' } : { type: 'reset-area', area: definition.area }); }}>Restore theme colors</Button>
                </div>
            </div>}
            <p role="status" className="text-xs text-app-muted">{saving ? 'Saving colors…' : message}</p>
            {error && <p role="alert" className="text-sm text-control-danger">{error}</p>}
        </div>
    </Section>;
}
