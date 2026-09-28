export const CODEMIRROR_SHORTCUTS = [
  { action: 'Save file', keys: ['Ctrl/Cmd', 'S'] },
  { action: 'Find and replace', keys: ['Ctrl/Cmd', 'F'] },
  { action: 'Go to line', keys: ['Ctrl/Cmd', 'G'] },
  { action: 'Toggle line comment', keys: ['Ctrl/Cmd', '/'] },
  { action: 'Close editor', keys: ['Ctrl/Cmd', 'W'] },
  { action: 'Undo', keys: ['Ctrl/Cmd', 'Z'] },
  { action: 'Redo', keys: ['Ctrl/Cmd', 'Shift', 'Z'] },
  { action: 'Close an open editor panel', keys: ['Esc'] },
] as const;

export const CODEMIRROR_SHORTCUT_HINTS = CODEMIRROR_SHORTCUTS.map(
  ({ keys }) => keys.join('+'),
);

export function isCommentShortcut(event: KeyboardEvent): boolean {
  const ctrlOrMeta = event.ctrlKey || event.metaKey;
  const isSlashShortcut =
    event.key === '/' ||
    event.code === 'Slash' ||
    event.code === 'NumpadDivide';

  return ctrlOrMeta && isSlashShortcut;
}
