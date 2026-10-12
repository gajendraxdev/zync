/** Shared visual states for native controls; no feature or runtime dependencies.
 * Arbitrary token references let tailwind-merge preserve existing caller overrides.
 */
export const CONTROL_BASE_CLASSES = 'rounded-[var(--zync-control-radius)] text-[length:var(--zync-control-font-size)] transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-control-focus disabled:cursor-not-allowed disabled:opacity-50';

/** Compact/clipped chrome keeps its keyboard indicator inside the control bounds. */
export const CONTROL_INSET_FOCUS_CLASSES = 'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-control-focus';

/** Labels retain theme foreground contrast without applying an extra opacity layer. */
export const CONTROL_LABEL_CLASSES = 'block text-[length:var(--zync-control-label-size)] font-medium text-app-muted';
