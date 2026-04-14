import type { GhostPopupState } from './types';

export function createClosedGhostPopupState(): GhostPopupState {
  return { visible: false, items: [], selectedIndex: 0, anchorLine: '' };
}

export function createOpenGhostPopupState(items: string[], anchorLine = ''): GhostPopupState {
  return { visible: items.length > 0, items, selectedIndex: 0, anchorLine };
}

export function moveGhostPopupSelectionState(
  state: GhostPopupState,
  delta: number,
): GhostPopupState {
  if (!state.visible || state.items.length === 0) return state;
  const len = state.items.length;
  const rawIndex = state.selectedIndex + delta;
  const selectedIndex = ((rawIndex % len) + len) % len;
  return { ...state, selectedIndex };
}
