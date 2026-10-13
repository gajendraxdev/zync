interface MenuKeyEvent {
    key: string;
    defaultPrevented: boolean;
    target: EventTarget | null;
    preventDefault: () => void;
    stopPropagation: () => void;
}

/** Move within one menu layer; nested flyouts retain their own keyboard ownership. */
export function moveMenuFocus(panel: HTMLElement | null, event: MenuKeyEvent): void {
    if (!panel || event.defaultPrevented
        || event.target instanceof Element && event.target.closest('[role="menu"]') !== panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
        .filter(item => item.closest('[role="menu"]') === panel);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % items.length
        : event.key === 'ArrowUp' ? (index <= 0 ? items.length - 1 : index - 1)
            : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault(); event.stopPropagation();
    items[next].focus({ preventScroll: true });
}
