import { useCallback, useRef, useState, type RefObject } from 'react';

/** Keep automatic pane activation quiet without changing its keyboard focus owner.
 * Native focus-visible styling resumes on user input or a subsequent focus change.
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
  const onFocusCapture = useCallback(() => {
    if (!activating.current) revealFocus();
  }, [revealFocus]);
  return { quiet, focusOnActivation, onFocusCapture, revealFocus };
}
