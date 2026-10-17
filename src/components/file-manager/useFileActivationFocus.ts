import { useCallback, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react';

const LISTING_FOCUS_KEYS = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
  'Tab', 'Enter', ' ', 'F2', 'ContextMenu',
]);

/** Keep automatic pane activation quiet without changing its keyboard focus owner.
 * Listing indicators follow Files input intent, not focus inherited from a dialog.
 * React portal events can reach this owner without belonging to its DOM scope.
 */
export function useFileActivationFocus(scope: RefObject<HTMLElement | null>, listing: RefObject<HTMLElement | null>) {
  const [quiet, setQuiet] = useState(true);
  const activating = useRef(false);
  const focusOnActivation = useCallback(() => {
    const target = listing.current ?? scope.current;
    if (!target) return;
    setQuiet(true);
    activating.current = true;
    try { target.focus({ preventScroll: true }); }
    finally { activating.current = false; }
  }, [listing, scope]);
  const revealFocus = useCallback(() => setQuiet(false), []);
  const onKeyDownCapture = useCallback((event: KeyboardEvent<HTMLElement>) => {
    // Typing in a portaled modal must not turn its automatic opener restoration
    // into keyboard navigation of the listing underneath it.
    if (!(event.target instanceof Node) || !scope.current?.contains(event.target)) return;
    // Clipboard/application accelerators operate on the existing selection, not
    // its focus cursor. They must not create a full-area ring when no row is active.
    if (event.target === listing.current && !LISTING_FOCUS_KEYS.has(event.key)
      && !(event.key === 'F10' && event.shiftKey)) return;
    revealFocus();
  }, [listing, scope, revealFocus]);
  const onPointerDownCapture = useCallback(() => setQuiet(true), []);
  const onFocusCapture = useCallback((event: FocusEvent<HTMLElement>) => {
    if (activating.current || !scope.current?.contains(event.target)) return;
    // Internal Tab navigation is observed above. Also recognize keyboard entry
    // from a neighboring surface, but not programmatic dialog/menu restoration.
    const previous = event.relatedTarget;
    if (previous instanceof Element && !scope.current.contains(previous)
      && !previous.closest('[role="dialog"], [role="menu"]')
      && event.target.matches(':focus-visible')) revealFocus();
  }, [scope, revealFocus]);
  return { quiet, focusOnActivation, onFocusCapture, onKeyDownCapture, onPointerDownCapture };
}
