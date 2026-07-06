/**
 * Classify non-printable terminal input for ghost InputTracker desync policy (P2).
 */

export type EscapeInputClass = 'cursor_edit' | 'history_edit' | 'unknown';

export const CTRL_R = '\x12';

const CURSOR_EDIT_SEQUENCES = new Set([
  '\x1b[D', // Left
  '\x1b[C', // Right (ghost accept handled earlier when suffix is active)
  '\x1b[H',
  '\x1bOH',
  '\x1b[1~',
  '\x1b[7~', // Home
  '\x1b[F',
  '\x1bOF',
  '\x1b[4~',
  '\x1b[8~', // End
]);

const HISTORY_EDIT_SEQUENCES = new Set([
  '\x1b[A',
  '\x1bOA', // Up
  '\x1b[B',
  '\x1bOB', // Down
]);

/** Map raw xterm key bytes to a desync class; null when not an escape/control edit key. */
export function classifyInputEscape(data: string): EscapeInputClass | null {
  if (data === CTRL_R) return 'history_edit';
  if (!data.startsWith('\x1b')) return null;
  if (CURSOR_EDIT_SEQUENCES.has(data)) return 'cursor_edit';
  if (HISTORY_EDIT_SEQUENCES.has(data)) return 'history_edit';
  return 'unknown';
}