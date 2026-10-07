import { isShortcutInput } from '../../features/shortcuts/route.js';
import { ptyBytesForKeyEvent } from './ptyKeyTranslations.js';

/** Common host xterm boundary: consumed app keys never also reach a PTY. */
export function routeTerminalKey(event: KeyboardEvent, write: (bytes: string) => void): boolean {
  if (event.type !== 'keydown') return true;
  if (event.defaultPrevented) return false;
  if (!isShortcutInput(event)) return true;
  const bytes = ptyBytesForKeyEvent(event);
  if (!bytes) return true;
  event.preventDefault();
  write(bytes);
  return false;
}
