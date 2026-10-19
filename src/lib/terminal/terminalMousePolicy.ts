export type TerminalRightClickAction = 'context-menu' | 'auto';

export interface TerminalMousePreferences {
  rightClickAction?: unknown;
  copyOnSelect?: unknown;
}

/** Retain the established default and fold the earlier separate modes into Auto. */
export function normalizeTerminalRightClickAction(value: unknown): TerminalRightClickAction {
  return value === 'auto' || value === 'paste' || value === 'passthrough' ? 'auto' : 'context-menu';
}

/** Decide once per gesture; Auto gives application mouse reporting priority over clipboard actions. */
export function resolveTerminalRightClick(
  preferences: TerminalMousePreferences,
  mouseTracking: boolean,
  shiftKey: boolean,
): 'menu' | 'paste' | 'pass' {
  if (shiftKey) return 'menu';
  const action = normalizeTerminalRightClickAction(preferences.rightClickAction);
  if (action === 'context-menu') return 'menu';
  return mouseTracking ? 'pass' : 'paste';
}
