const INSTALL_ID_KEY = 'zync.usage.installId';

let memoryInstallId: string | null = null;

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getOrCreateInstallId(): string {
  if (memoryInstallId && isUuid(memoryInstallId)) return memoryInstallId;
  try {
    const existing = localStorage.getItem(INSTALL_ID_KEY)?.trim() ?? '';
    if (isUuid(existing)) {
      memoryInstallId = existing;
      return existing;
    }
  } catch {
    // private mode
  }
  const created = crypto.randomUUID();
  memoryInstallId = created;
  try {
    localStorage.setItem(INSTALL_ID_KEY, created);
  } catch {
    // keep memoryInstallId for this session
  }
  return created;
}
