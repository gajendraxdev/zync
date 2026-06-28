let webgl2Availability: boolean | null = null;

/**
 * Probes WebGL2 support once per runtime (cached).
 * Safe in SSR/non-DOM contexts — returns false when `document` is unavailable.
 */
export function isWebgl2Available(): boolean {
  if (webgl2Availability !== null) {
    return webgl2Availability;
  }

  if (typeof document === 'undefined') {
    webgl2Availability = false;
    return false;
  }

  try {
    const canvas = document.createElement('canvas');
    webgl2Availability = Boolean(canvas.getContext('webgl2'));
  } catch {
    webgl2Availability = false;
  }

  return webgl2Availability;
}

/** Test-only: clears the cached probe result. */
export function resetWebgl2AvailabilityCache(): void {
  webgl2Availability = null;
}

/** Test-only: returns whether a probe has been cached (`null` = not yet probed). */
export function getWebgl2AvailabilityCacheForTests(): boolean | null {
  return webgl2Availability;
}