/**
 * Normalize ghost suffix spacing against the full typed line.
 * Mirrors Rust `ghost::suffix` (runtime uses Rust; kept for unit tests).
 *
 * Providers own word boundaries — this never invents a leading space
 * (history `ls` + `blk` must stay `blk`, not ` blk`).
 */
export function normalizeSuggestionSuffix(line: string, suffix: string): string {
  if (!suffix) return suffix;

  const endsWithSpace = /[ \t]$/.test(line);
  if (endsWithSpace) {
    return suffix.replace(/^[ \t]+/, '');
  }

  return suffix;
}
