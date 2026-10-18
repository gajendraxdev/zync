import { useLayoutEffect, useRef, type RefObject } from 'react';

/** Keep one logical opener when the same inspector moves between inline and modal chrome. */
export function useFileInspectorFocus(open: boolean, inline: boolean,
  scope: RefObject<HTMLElement | null>, listing: RefObject<HTMLElement | null>, active = true) {
  const opener = useRef<HTMLElement | null>(null);
  const previous = useRef({ open, inline });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { open, inline };
    if (!active) { opener.current = null; return; }
    if (open && !before.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if ((!open && before.open) || (open && inline && !before.inline)) {
      // Modal teardown can restore a control from the outgoing surface. Run after
      // that teardown, and cancel if another layout/open state supersedes it.
      const frame = requestAnimationFrame(() => {
        const target = open
          ? scope.current?.querySelector<HTMLElement>('[data-file-inspector-close]')
          : opener.current?.isConnected ? opener.current : listing.current;
        target?.focus({ preventScroll: true });
        if (!open) opener.current = null;
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [open, inline, scope, listing, active]);
}
