/// <reference lib="dom" />
/** Browser-only helper. Requires an axis-aligned slot, at least 240×100px. */
export function mountTerminalSurface(element: HTMLElement, offerId: string, options?: { timeoutMs?: number }): {
  /** False on older hosts; use the existing confirmed command runner instead. */
  readonly ready: Promise<boolean>;
  /** Re-measure after plugin-specific layout changes. */
  refresh(): void;
  /** Release the host slot and session; safe to call twice. */
  dispose(): void;
};
