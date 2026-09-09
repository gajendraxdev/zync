export function isFailedLazyImport(error: Error | null): boolean {
  const text = `${error?.name ?? ''} ${error?.message ?? ''} ${error?.stack ?? ''}`;
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(text);
}
