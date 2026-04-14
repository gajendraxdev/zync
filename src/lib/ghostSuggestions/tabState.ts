import type { GhostTabState } from './types';

export function createInitialGhostTabState(): GhostTabState {
  return { lastLine: '', lastAt: 0 };
}

export function resetGhostTabState(): GhostTabState {
  return createInitialGhostTabState();
}
