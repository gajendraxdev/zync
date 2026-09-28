export function resolveSavedBaseline<T>(
  baselineAtSaveStart: T | null,
  currentBaseline: T | null,
  savedDocument: T,
): T | null {
  return currentBaseline === baselineAtSaveStart ? savedDocument : currentBaseline;
}
