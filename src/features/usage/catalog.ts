/** Keep in sync with zync-analytics/internal/usage/catalog.go */
export const USAGE_FEATURES = [
  'files',
  'terminal',
  'split',
  'tunnels',
  'vault',
  'public_urls',
  'snippets',
  'dashboard',
  'plugins',
] as const;

export type UsageFeatureId = (typeof USAGE_FEATURES)[number];

const known = new Set<string>(USAGE_FEATURES);

export function isUsageFeatureId(id: string): id is UsageFeatureId {
  return known.has(id);
}
