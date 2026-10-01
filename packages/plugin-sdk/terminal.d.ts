/// <reference lib="dom" />
/** Register an open popup above host terminal content. Dispose on close/unmount.
 * Older hosts temporarily hide the surface; sessions and layout remain intact.
 * Newer hosts clip only popup bounds, including over the header. Maximum 8 popups.
 */
export function registerTerminalOverlay(element: HTMLElement): { refresh(): void; dispose(): void };
/** Browser-only helper. Requires an axis-aligned slot, at least 240×100px. */
export function mountTerminalSurface(element: HTMLElement, offerId: string, options?: { timeoutMs?: number }): {
  /** False on older hosts; use the existing confirmed command runner instead. */
  readonly ready: Promise<boolean>;
  /** Re-measure after plugin-specific layout changes. */
  refresh(): void;
  /** Release the host slot and session; safe to call twice. */
  dispose(): void;
};
