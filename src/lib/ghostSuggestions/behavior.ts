import type { GhostTabState } from './types';

export type GhostTabAction =
  | { kind: 'fallback' }
  | { kind: 'accept'; suffix: string; nextState: GhostTabState }
  | { kind: 'show_list'; nextState: GhostTabState };

export function longestCommonPrefix(values: string[]): string {
  if (!values.length) return '';
  let prefix = values[0] ?? '';
  for (let i = 1; i < values.length; i++) {
    const v = values[i] ?? '';
    let j = 0;
    const max = Math.min(prefix.length, v.length);
    while (j < max && prefix[j] === v[j]) j++;
    prefix = prefix.slice(0, j);
    if (!prefix) break;
  }
  return prefix;
}

export function resolveTabAction(
  line: string,
  items: string[],
  prevState: GhostTabState,
  now: number,
  doubleTabWindowMs = 700,
): GhostTabAction {
  if (!items.length) return { kind: 'fallback' };

  const nextState: GhostTabState = { lastLine: line, lastAt: now };

  if (items.length === 1 && items[0] === '') return { kind: 'fallback' };
  if (items.length === 1) {
    return { kind: 'accept', suffix: items[0], nextState };
  }

  const isDoubleTab = prevState.lastLine === line && (now - prevState.lastAt) < doubleTabWindowMs;
  const sharedPrefix = longestCommonPrefix(items);
  if (sharedPrefix && !isDoubleTab) {
    return { kind: 'accept', suffix: sharedPrefix, nextState };
  }

  return { kind: 'show_list', nextState };
}
