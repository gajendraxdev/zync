export interface LazyPtyVisibility {
  isWorkspaceActive: boolean;
  isTerminalView: boolean;
  isActiveTab: boolean;
}

export type LazyPtyAction = 'none' | 'suspend_panel' | 'spawn';

/**
 * Lazy PTY policy: defer spawn until a shell tab is first selected; keep PTYs alive
 * when switching hosts or internal shell tabs; suspend only when leaving terminal view
 * (Files/Dashboard) within the active workspace.
 *
 * Background workspace hosts intentionally stay alive (no idle-timer suspend).
 */
export function resolveLazyPtyAction(
  visibility: LazyPtyVisibility,
  spawned: boolean,
): LazyPtyAction {
  if (!visibility.isWorkspaceActive) {
    return 'none';
  }

  if (!visibility.isTerminalView) {
    return visibility.isActiveTab && spawned ? 'suspend_panel' : 'none';
  }

  if (!visibility.isActiveTab) {
    return 'none';
  }

  return spawned ? 'none' : 'spawn';
}