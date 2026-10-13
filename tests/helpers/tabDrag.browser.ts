interface DragOptions {
    after?: boolean;
    cancel?: boolean;
    stripPadding?: boolean;
    during?: () => void;
}

const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Authored fixture gesture using the production pointer path, not direct store mutations. */
export async function dragTab(source: HTMLElement, destination: HTMLElement, options: DragOptions = {}): Promise<void> {
    const start = source.getBoundingClientRect(), end = destination.getBoundingClientRect();
    const strip = destination.closest('[data-tab-drag-strip]');
    const vertical = strip?.getAttribute('data-tab-drag-axis') === 'vertical';
    const pointIn = (rect: DOMRect) => {
        const fraction = options.after === false ? 0.25 : 0.75;
        return { clientX: vertical ? (options.stripPadding ? strip!.getBoundingClientRect().left + 2 : rect.left + rect.width / 2) : rect.left + rect.width * fraction,
            clientY: vertical ? rect.top + rect.height * fraction : options.stripPadding ? strip!.getBoundingClientRect().top + 2 : rect.top + rect.height / 2 };
    };
    const point = pointIn(end);
    const init = { bubbles: true, cancelable: true, pointerId: 61, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
    source.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: start.left + 16, clientY: start.top + start.height / 2 }));
    try {
        window.dispatchEvent(new PointerEvent('pointermove', { ...init, ...point }));
        await settle();
        options.during?.();
        // Fixture result text may change geometry. Release over the live destination.
        const release = destination.getBoundingClientRect();
        const releasePoint = pointIn(release);
        if (options.cancel) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        else window.dispatchEvent(new PointerEvent('pointerup', { ...init, ...releasePoint, buttons: 0 }));
        await settle();
    } finally {
        window.dispatchEvent(new PointerEvent('pointercancel', { ...init, ...point, buttons: 0 }));
    }
}

/** Hold at a visible strip edge so scrolling must continue without new pointer events. */
export async function dragTabAtEdge(source: HTMLElement, strip: HTMLElement): Promise<void> {
    const start = source.getBoundingClientRect(), bounds = strip.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, pointerId: 62, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
    source.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: start.left + 16, clientY: start.top + start.height / 2 }));
    try {
        window.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: bounds.right - 4, clientY: start.top + start.height / 2 }));
        for (let frame = 0; frame < 24; frame++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    } finally {
        window.dispatchEvent(new PointerEvent('pointercancel', init));
        await settle();
    }
}
