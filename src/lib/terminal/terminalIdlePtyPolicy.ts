/** Side-effect-free idle-host settings shared by persistence and the PTY scheduler. */
export const DEFAULT_SUSPEND_IDLE_HOST_PTYS = false;
export const DEFAULT_IDLE_HOST_PTY_SUSPEND_MINUTES = 2;
export const MIN_IDLE_HOST_PTY_SUSPEND_MINUTES = 1;
export const MAX_IDLE_HOST_PTY_SUSPEND_MINUTES = 60;
/** Default delay before suspending PTYs on a background workspace host. */
export const DEFAULT_IDLE_PTY_SUSPEND_MS = 120_000;
/** Minimum delay before retrying idle suspend when tabs stay process-busy. */
export const MIN_IDLE_SUSPEND_BUSY_RETRY_MS = 1_000;

/** Resolve stored minutes to the supported whole-minute range, with a safe default. */
export function normalizeIdleHostPtySuspendMinutes(minutes: number | undefined): number {
  if (minutes == null || !Number.isFinite(minutes)) {
    return DEFAULT_IDLE_HOST_PTY_SUSPEND_MINUTES;
  }
  return Math.max(
    MIN_IDLE_HOST_PTY_SUSPEND_MINUTES,
    Math.min(MAX_IDLE_HOST_PTY_SUSPEND_MINUTES, Math.round(minutes)),
  );
}

/** Return a scheduling delay, or null when idle suspend is disabled; never starts a timer. */
export function resolveIdleHostPtySuspendDelayMs(
  enabled: boolean,
  minutes: number | undefined,
): number | null {
  if (!enabled) {
    return null;
  }
  const resolvedMinutes = normalizeIdleHostPtySuspendMinutes(minutes);
  return resolvedMinutes * 60_000;
}
