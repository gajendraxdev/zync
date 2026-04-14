/**
 * SuggestionEngine — orchestrates suggestion providers in priority order.
 *
 * Phase 1: synchronous HistoryProvider only.
 * Phase 3: AiProvider will be added as a second async provider with its own debounce.
 */

export interface SyncSuggestionProvider {
  name: string;
  query(line: string): string;
}

export class SuggestionEngine {
  private readonly providers: SyncSuggestionProvider[];
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(providers: SyncSuggestionProvider[]) {
    this.providers = [...providers];
  }

  /**
   * Query all providers synchronously, returning the first non-empty result.
   * Returns '' when no provider matched or line is too short.
   */
  querySync(line: string): string {
    if (line.trim().length < 2) return '';
    for (const provider of this.providers) {
      const result = provider.query(line);
      if (result) return result;
    }
    return '';
  }

  /**
   * Query with optional debounce. Pass debounceMs=0 (default) for immediate
   * synchronous resolution — used in Phase 1 with history-only providers.
   * Phase 3 async providers will pass a positive debounceMs.
   */
  queryDebounced(
    line: string,
    callback: (suffix: string) => void,
    debounceMs = 0,
  ): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (debounceMs === 0) {
      callback(this.querySync(line));
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      callback(this.querySync(line));
    }, debounceMs);
  }

  cancel(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  destroy(): void {
    this.cancel();
  }
}
