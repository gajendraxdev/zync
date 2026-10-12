import { useId } from 'react';
import { ELEMENT_COLOR_AREAS, ELEMENT_COLOR_DEFINITIONS, type ElementColors } from '../domain/elementColors';
import { THEME_PALETTE_KEYS } from '../domain/themeDocument';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Textarea';

/** A replaceable elements block, not a standalone theme or flattened default palette. */
export const THEME_ELEMENTS_EXAMPLE = JSON.stringify({
    version: 1,
    overrides: {
        'navigation.background': '#111827',
        'navigation.foreground': '#e5e7eb',
    },
} satisfies ElementColors, null, 2);

interface ThemeKeyReferenceProps {
    open: boolean;
    onClose(): void;
}

/** Read-only help uses the editor/validator catalogs. It never exports or saves preferences. */
export function ThemeKeyReference({ open, onClose }: ThemeKeyReferenceProps) {
    const exampleHint = useId();
    return <Modal isOpen={open} onClose={onClose} title="Theme JSON keys" width="max-w-2xl"
        subtitle="A reference for editing your exported theme—not extra fields to add.">
        <div className="min-w-0 space-y-5" data-zync-color-protected>
            <section className="space-y-2" aria-label="Palette keys">
                <h4 className="text-sm font-medium">Base palette · {THEME_PALETTE_KEYS.length} required colors</h4>
                <p className="text-xs text-app-muted">Keep every key in the palette object. These colors provide the defaults for the interface.</p>
                <ul className="flex flex-wrap gap-2 text-xs">{THEME_PALETTE_KEYS.map(key => <li key={key}>
                    <code className="inline-block rounded bg-app-surface px-2 py-1">{key}</code>
                </li>)}</ul>
            </section>
            <section className="space-y-3" aria-label="Element override keys">
                <h4 className="text-sm font-medium">Element overrides · {ELEMENT_COLOR_DEFINITIONS.length} optional colors</h4>
                <p className="text-xs text-app-muted">Add only the colors you want to customize inside elements.overrides. Remove a key to restore its theme color. Export includes saved overrides, not inherited colors or unsaved drafts. Expand an area to find its keys.</p>
                {ELEMENT_COLOR_AREAS.map(area => {
                    const fields = ELEMENT_COLOR_DEFINITIONS.filter(entry => entry.area === area);
                    return <details key={area} className="rounded-md border border-app-border">
                        <summary className="cursor-pointer rounded-md px-3 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-control-focus">{fields[0].areaLabel} · {fields.length} colors</summary>
                        <dl className="border-t border-app-border px-3 text-xs divide-y divide-app-border">
                            {fields.map(field => <div key={field.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
                                <dt className="min-w-0 break-all font-mono">{field.key}</dt>
                                <dd className="text-app-muted">{field.label}</dd>
                            </div>)}
                        </dl>
                    </details>;
                })}
            </section>
            <section className="space-y-2" aria-label="Theme JSON example">
                <h4 className="text-sm font-medium">Copyable example</h4>
                <p id={exampleHint} className="text-xs text-app-muted">Replace the elements block in your exported theme with this example, or add its keys to your existing overrides. This block alone is not a complete theme file. Select the text to copy it.</p>
                <Textarea label="Example elements block" aria-describedby={exampleHint} readOnly spellCheck={false}
                    rows={8} value={THEME_ELEMENTS_EXAMPLE} className="font-mono text-xs" />
            </section>
            <p className="text-xs text-app-muted">Use opaque six-digit hex colors such as #334455. Unknown keys, extra fields and unsupported versions are rejected. Fonts, sizes, transparency, images, gradients and layout are not part of version 1.</p>
            <div className="flex justify-end"><Button type="button" variant="secondary" onClick={onClose}>Close reference</Button></div>
        </div>
    </Modal>;
}
