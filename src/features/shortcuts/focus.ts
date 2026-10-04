import { isXtermKeyboardTarget } from '../../lib/shortcuts';
import type { KeyboardFocus } from './types';

export function keyboardFocus(target: EventTarget | null | undefined): KeyboardFocus {
    if (isXtermKeyboardTarget(target)) {
        return 'xterm';
    }
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return 'field';
    }
    if (target instanceof HTMLElement && target.tagName === 'SELECT') return 'field';
    if (target instanceof HTMLElement && target.isContentEditable) {
        return 'field';
    }
    return 'app';
}

/** Composed paths preserve the focused inner element of host shadow roots. */
export function keyboardEventFocus(event: KeyboardEvent): KeyboardFocus {
    return keyboardFocus(event.composedPath?.()[0] ?? event.target);
}

/** Local surfaces/recorders own keys before global capture listeners run. */
export function ownsLocalKeyboard(event: KeyboardEvent): boolean {
    if (document.querySelector('[data-zync-shortcut-recording="true"]')) return true;
    const path = event.composedPath?.() ?? [event.target];
    return path.some(node => node instanceof HTMLElement && Boolean(node.closest(
        '[data-zync-shortcuts="local"], [role="dialog"], [role="alertdialog"]',
    )));
}
