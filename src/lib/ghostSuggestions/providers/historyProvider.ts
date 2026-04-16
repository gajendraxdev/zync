/**
 * CommandHistory — in-memory ring buffer of committed commands.
 *
 * Phase 1: lives inside terminalCache alongside the InputTracker.
 * Phase 2: will be persisted per-connection via Tauri store (ghostSuggestionSlice).
 */

const DEFAULT_MAX_SIZE = 500;

export class CommandHistory {
  private entries: string[] = [];
  private readonly maxSize: number;

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /**
   * Add a command. Deduplicates (moves existing entry to front) and trims to maxSize.
   */
  commit(command: string): void {
    const trimmed = command.trim();
    if (!trimmed) return;

    const existing = this.entries.indexOf(trimmed);
    if (existing !== -1) this.entries.splice(existing, 1);

    this.entries.unshift(trimmed);

    if (this.entries.length > this.maxSize) {
      this.entries.length = this.maxSize;
    }
  }

  /**
   * Returns the suffix that completes `prefix` using the most recent matching entry.
   * Returns '' when there is no match or prefix is too short.
   */
  match(prefix: string): string {
    const trimmed = prefix.trim();
    if (trimmed.length < 2) return '';

    // Use the original prefix (not trimmed) for matching and slicing so that
    // trailing spaces in the prefix are preserved and compared correctly.
    const match = this.entries.find(cmd => cmd.startsWith(prefix) && cmd !== prefix);
    return match ? match.slice(prefix.length) : '';
  }

  getEntries(): readonly string[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}
