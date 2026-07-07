/**
 * Opt-in ghost suggestion debug logging.
 * Enable in devtools: localStorage.setItem('zync:ghost-debug', '1'); location.reload();
 * Disable: localStorage.removeItem('zync:ghost-debug');
 */

const STORAGE_KEY = 'zync:ghost-debug';

let announced = false;

export function isGhostDebugEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function ghostDebug(scope: string, detail: Record<string, unknown>): void {
  if (!isGhostDebugEnabled()) return;
  if (!announced) {
    announced = true;
    console.info('[Ghost:debug] logging enabled (localStorage zync:ghost-debug=1)');
  }
  console.info(`[Ghost:${scope}]`, detail);
}