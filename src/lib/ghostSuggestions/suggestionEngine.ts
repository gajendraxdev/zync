/**
 * SuggestionEngine — orchestrates synchronous suggestion providers in priority order.
 *
 * All providers implement the synchronous `SyncSuggestionProvider` contract.
 * Async providers (e.g. AI) are handled upstream via the IPC layer in `client.ts`
 * and do not go through this engine.
 */

export interface SyncSuggestionProvider {
  /** Display name used for error reporting. */
  name: string;
  /** Return a non-empty suffix to complete `line`, or '' when no match. */
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
      try {
        const result = provider.query(line);
        if (result) return result;
      } catch (err) {
        console.error(`[SuggestionEngine] Provider "${provider.name}" threw:`, err);
      }
    }
    return '';
  }

  /**
   * Query with optional debounce. Pass debounceMs=0 (default) for immediate
   * synchronous resolution. Pass a positive debounceMs to delay the callback
   * (useful when called from a high-frequency input handler).
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
