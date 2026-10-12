const activeGuards = new WeakMap<Window, () => void>();

/** Shared release-click guard; WebViews may dispatch it after a drop's render settles. */
export function suppressDropClick(target: Window = window): void {
    activeGuards.get(target)?.();

    const cleanup = () => {
        target.removeEventListener('click', suppress, { capture: true });
        target.removeEventListener('pointerdown', cleanup, { capture: true });
        target.removeEventListener('blur', cleanup);
        activeGuards.delete(target);
    };
    const suppress = (event: Event) => {
        cleanup();
        // Keyboard and programmatic activation are not a drag-release click.
        if ('detail' in event && event.detail === 0) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };

    activeGuards.set(target, cleanup);
    target.addEventListener('click', suppress, { capture: true });
    target.addEventListener('pointerdown', cleanup, { capture: true });
    target.addEventListener('blur', cleanup);
}
