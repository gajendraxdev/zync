import { useEffect, useId, useRef, useState, type ReactNode, type PointerEvent, type RefObject } from 'react';
import { Button } from './Button';
import { Input } from './Input';
import { TopbarDropdown } from './TopbarDropdown';
import { CONTROL_BASE_CLASSES } from './controlStyles';
import { colorFieldPoint, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, type HSV } from './colorPickerMath';

export interface ColorPickerProps {
    label: string;
    /** Controlled opaque hex draft; empty/invalid drafts show the reference without rewriting them. */
    value: string;
    referenceColor?: string | null;
    disabled?: boolean;
    palette?: ReadonlyArray<{ label: string; color: string }>;
    onChange: (color: string) => void;
    onOpen?: () => void;
    children?: ReactNode;
    className?: string;
}

/** Reusable draft picker. The caller owns validation at its boundary, Apply, reset and persistence. */
export function ColorPicker({ label, value, referenceColor, disabled = false, palette = [], onChange, onOpen, children, className }: ColorPickerProps) {
    const [open, setOpen] = useState(false);
    const trigger = useRef<HTMLButtonElement>(null);
    const panel = useRef<HTMLDivElement>(null);
    const hexInput = useRef<HTMLInputElement>(null);
    const popupId = useId();
    useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
    const effective = hexToRgb(value) ? value.toLowerCase() : referenceColor && hexToRgb(referenceColor) ? referenceColor.toLowerCase() : '#000000';
    return <>
        <Button ref={trigger} type="button" variant="secondary" className={className} disabled={disabled}
            aria-label={`Edit ${label} color`} aria-haspopup="dialog" aria-expanded={open && !disabled}
            aria-controls={open && !disabled ? popupId : undefined}
            onClick={() => { onOpen?.(); setOpen(current => !current); }}>
            {children ?? <><span aria-hidden="true" className="mr-2 h-5 w-5 rounded border border-app-border" style={{ backgroundColor: effective }} />{label}</>}
        </Button>
        {open && !disabled && <TopbarDropdown anchor={trigger.current} widthClass="w-80 max-w-[calc(100vw-16px)]" className="p-3"
            data-zync-color-picker-open="true" data-zync-color-protected data-zync-shortcuts="local">
            <ColorPickerPanel key={popupId} panelRef={panel} hexRef={hexInput} trigger={trigger.current}
                id={popupId} label={label} value={value} effective={effective} palette={palette}
                onChange={onChange} onClose={restore => { setOpen(false); if (restore && trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); }} />
        </TopbarDropdown>}
    </>;
}

function ColorPickerPanel({ panelRef, hexRef, trigger, id, label, value, effective, palette, onChange, onClose }: {
    panelRef: RefObject<HTMLDivElement | null>; hexRef: RefObject<HTMLInputElement | null>;
    trigger: HTMLButtonElement | null; id: string; label: string; value: string; effective: string;
    palette: ColorPickerProps['palette']; onChange: ColorPickerProps['onChange']; onClose: (restore: boolean) => void;
}) {
    const initial = useRef(effective);
    const [hsv, setHsv] = useState(() => rgbToHsv(hexToRgb(effective)!));
    const current = useRef(hsv);
    const [rgbDraft, setRgbDraft] = useState(() => {
        const rgb = hexToRgb(effective)!; return { r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) };
    });
    const [rgbError, setRgbError] = useState(false);
    const emitted = useRef<string | null>(null);
    const frame = useRef(0);
    const pointer = useRef<number | null>(null);
    const nextPoint = useRef<{ s: number; v: number } | null>(null);
    const callbacks = useRef({ onChange, onClose });
    callbacks.current = { onChange, onClose };
    useEffect(() => {
        if (effective === emitted.current) { emitted.current = null; return; }
        emitted.current = null;
        current.current = rgbToHsv(hexToRgb(effective)!, current.current.h); setHsv(current.current);
    }, [effective]);
    useEffect(() => {
        const rgb = hexToRgb(effective)!;
        setRgbDraft({ r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) }); setRgbError(false);
    }, [effective]);
    useEffect(() => {
        // Anchored surfaces are hidden until their first measured placement.
        // Focus after that commit; focusing a hidden input silently fails.
        const focusFrame = requestAnimationFrame(() => hexRef.current?.focus({ preventScroll: true }));
        const outside = (event: Event) => {
            const target = event.target;
            if (target instanceof Node && !panelRef.current?.contains(target) && !trigger?.contains(target)) callbacks.current.onClose(false);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) return;
            event.preventDefault(); event.stopPropagation(); callbacks.current.onClose(true);
        };
        document.addEventListener('pointerdown', outside, true);
        document.addEventListener('focusin', outside);
        window.addEventListener('keydown', escape, true);
        return () => {
            cancelAnimationFrame(focusFrame);
            cancelAnimationFrame(frame.current);
            document.removeEventListener('pointerdown', outside, true);
            document.removeEventListener('focusin', outside);
            window.removeEventListener('keydown', escape, true);
        };
        // Callback refs keep listeners fresh without resetting focus on every draft edit.
    }, [hexRef, panelRef, trigger]);
    const choose = (next: HSV) => {
        current.current = next; setHsv(next);
        const rgb = hsvToRgb(next); const hex = rgbToHex(rgb);
        setRgbDraft({ r: String(rgb.r), g: String(rgb.g), b: String(rgb.b) }); setRgbError(false);
        emitted.current = hex; callbacks.current.onChange(hex);
    };
    const flushPoint = () => {
        frame.current = 0;
        if (nextPoint.current) { choose({ ...current.current, ...nextPoint.current }); nextPoint.current = null; }
    };
    const sample = (event: PointerEvent<HTMLDivElement>) => {
        nextPoint.current = colorFieldPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect());
    };
    const valid = !value || Boolean(hexToRgb(value));
    return <div ref={panelRef} id={id} role="dialog" aria-modal="false" aria-label={`${label} color picker`}
        onKeyDown={event => {
            // Own Tab inside the popup; do not let a parent Settings dialog trap portal focus.
            if (event.key !== 'Tab') return;
            event.stopPropagation();
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')];
            const first = controls[0]; const last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <p className="mb-3 text-sm font-medium">{label}</p>
        <div aria-hidden="true" className="relative h-32 w-full touch-none rounded-md cursor-crosshair border border-app-border"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${rgbToHex(hsvToRgb({ h: hsv.h, s: 100, v: 100 }))}` }}
            onPointerDown={event => {
                if (event.button !== 0 || pointer.current !== null) return;
                event.preventDefault(); pointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId);
                sample(event); flushPoint();
            }}
            onPointerMove={event => {
                if (pointer.current !== event.pointerId) return;
                sample(event); if (!frame.current) frame.current = requestAnimationFrame(flushPoint);
            }}
            onPointerUp={event => {
                if (pointer.current !== event.pointerId) return;
                cancelAnimationFrame(frame.current); sample(event); flushPoint(); pointer.current = null;
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onPointerCancel={() => { cancelAnimationFrame(frame.current); frame.current = 0; nextPoint.current = null; pointer.current = null; }}
            onLostPointerCapture={() => { cancelAnimationFrame(frame.current); frame.current = 0; nextPoint.current = null; pointer.current = null; }}>
            <span className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_black]"
                style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
        </div>
        <div className="mt-3 space-y-2">
            {(['h', 's', 'v'] as const).map(channel => <label key={channel} className="flex items-center gap-2 text-xs text-app-muted">
                <span className="w-16 shrink-0">{channel === 'h' ? 'Hue' : channel === 's' ? 'Saturation' : 'Brightness'}</span>
                <input type="range" aria-label={channel === 'h' ? 'Hue' : channel === 's' ? 'Saturation' : 'Brightness'} min={0} max={channel === 'h' ? 359 : 100}
                    step={1} value={Math.round(hsv[channel])} onChange={event => choose({ ...current.current, [channel]: Number(event.target.value) })}
                    className={`${CONTROL_BASE_CLASSES} min-w-0 flex-1 h-3 accent-[var(--color-app-accent)]${channel === 'h' ? ' zync-color-picker-hue' : ''}`} />
                <span className="w-8 text-right tabular-nums">{Math.round(hsv[channel])}{channel === 'h' ? '°' : '%'}</span>
            </label>)}
        </div>
        <div className="mt-3"><Input ref={hexRef} label="Hex color" placeholder={effective} value={value} maxLength={7} spellCheck={false}
            error={!valid ? 'Enter a six-digit hex color, for example #334455.' : undefined}
            onChange={event => onChange(event.target.value)} /></div>
        <div className="mt-3 grid grid-cols-3 gap-2">
            {(['r', 'g', 'b'] as const).map(channel => <Input key={channel} label={channel === 'r' ? 'Red' : channel === 'g' ? 'Green' : 'Blue'}
                type="number" min={0} max={255} step={1} value={rgbDraft[channel]} aria-invalid={rgbError || undefined}
                aria-describedby={rgbError ? `${id}-rgb-error` : undefined}
                onChange={event => {
                    const next = { ...rgbDraft, [channel]: event.target.value }; setRgbDraft(next);
                    const validChannels = Object.values(next).every(text => /^\d{1,3}$/.test(text) && Number(text) <= 255);
                    setRgbError(!validChannels);
                    if (validChannels) onChange(rgbToHex({ r: Number(next.r), g: Number(next.g), b: Number(next.b) }));
                }} />)}
        </div>
        {rgbError && <p id={`${id}-rgb-error`} role="status" className="mt-1 text-xs text-control-danger">RGB channels must be whole numbers from 0 to 255.</p>}
        <div className="my-3 flex gap-2 text-xs text-app-muted">
            <span className="flex flex-1 items-center gap-2"><span aria-hidden="true" className="h-5 w-5 rounded border border-app-border" style={{ backgroundColor: initial.current }} />Before</span>
            <span className="flex flex-1 items-center gap-2"><span aria-hidden="true" className="h-5 w-5 rounded border border-app-border" style={{ backgroundColor: effective }} />Preview</span>
        </div>
        {palette && palette.length > 0 && <div role="group" aria-label="Theme colors" className="mb-3 grid grid-cols-2 gap-2">
            {palette.filter(entry => hexToRgb(entry.color)).map(entry => <Button key={entry.label} type="button" size="sm" variant="secondary"
                className="justify-start gap-2" aria-label={`Use ${entry.label} theme color`} onClick={() => onChange(entry.color.toLowerCase())}>
                <span aria-hidden="true" className="h-4 w-4 shrink-0 rounded border border-app-border" style={{ backgroundColor: entry.color }} />
                <span className="truncate">{entry.label}</span>
            </Button>)}
        </div>}
        <p className="mb-3 text-xs text-app-muted">Changes are a draft. Apply them in the editor.</p>
        <Button type="button" size="sm" variant="secondary" disabled={rgbError || !valid} onClick={() => onClose(true)}>Done</Button>
    </div>;
}
