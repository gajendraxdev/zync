const INSTALL_ID_KEY = 'zync.usage.installId';

let memoryInstallId: string | null = null;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Returns the pseudonymous installation ID shared by usage reports and
 * explicitly submitted surveys. The existing storage key is retained so an
 * upgrade never creates a second identity for the same installation.
 */
export function getOrCreateInstallId(): string {
  if (memoryInstallId && isUuid(memoryInstallId)) return memoryInstallId;

  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY)?.trim() ?? '';
    if (isUuid(existing)) {
      memoryInstallId = existing;
      return existing;
    }
  } catch {
    // Storage may be unavailable. Keep a stable in-memory ID for this launch.
  }

  const created = crypto.randomUUID();
  memoryInstallId = created;

  try {
    localStorage.setItem(INSTALL_ID_KEY, created);
  } catch {
    // The in-memory value still prevents multiple IDs during this launch.
  }

  return created;
}

/** Read the pre-existing installation ID without creating a new claim hint. */
export function getExistingInstallId(): string | null {
  try {
    const value = localStorage.getItem(INSTALL_ID_KEY)?.trim() ?? '';
    return isUuid(value) ? value : null;
  } catch {
    return null;
  }
}
