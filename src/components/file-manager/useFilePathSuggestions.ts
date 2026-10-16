import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileFolderLoader, FileFolderOption } from './fileFolderOptions';
import { FILE_PATH_SUGGESTION_DELAY_MS, filePathCompletionQuery, filePathSuggestionMatches } from './filePathCompletion';

interface FolderResult {
  parent: string;
  loader: FileFolderLoader;
  status: 'loading' | 'ready' | 'error';
  folders: FileFolderOption[];
}

/** One edit-session parent cache; requests never write browsing state or survive a changed scope. */
export function useFilePathSuggestions(value: string, currentPath: string, homePath: string | undefined, loadFolders: FileFolderLoader, enabled: boolean) {
  const query = useMemo(() => filePathCompletionQuery(value, currentPath, homePath), [value, currentPath, homePath]);
  const parent = query?.parent;
  const cache = useRef<FolderResult | null>(null);
  const [result, setResult] = useState<FolderResult | null>(null);
  const [retryIndex, setRetryIndex] = useState(0);
  useEffect(() => {
    if (!enabled || parent === undefined) return;
    let active = true;
    const previous = cache.current;
    if (previous?.loader === loadFolders && previous.parent === parent && previous.status === 'ready') {
      setResult(previous);
      return;
    }
    setResult({ parent, loader: loadFolders, status: 'loading', folders: [] });
    const timer = window.setTimeout(() => {
      void loadFolders(parent).then(folders => {
        if (!active) return;
        const next: FolderResult = { parent, loader: loadFolders, status: 'ready', folders };
        cache.current = next;
        setResult(next);
      }).catch(() => {
        if (active) setResult({ parent, loader: loadFolders, status: 'error', folders: [] });
      });
    }, FILE_PATH_SUGGESTION_DELAY_MS);
    return () => { active = false; window.clearTimeout(timer); };
  }, [enabled, parent, loadFolders, retryIndex]);
  const current = result && result.parent === parent && result.loader === loadFolders ? result : null;
  const matches = useMemo(() => query && current?.status === 'ready'
    ? filePathSuggestionMatches(current.folders, query) : { options: [], total: 0 }, [query, current]);
  const retry = useCallback(() => { cache.current = null; setRetryIndex(index => index + 1); }, []);
  return { query, ...matches, status: !enabled || !query ? 'idle' : current?.status ?? 'loading', retry };
}
