/** Merge caller hints and the local validation message without duplicate ARIA references. */
export function fieldDescriptionIds(describedBy: string | undefined, errorId?: string): string | undefined {
  return [...new Set([
    ...(describedBy?.split(/\s+/).filter(Boolean) ?? []),
    ...(errorId ? [errorId] : []),
  ])].join(' ') || undefined;
}
