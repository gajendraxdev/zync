/** Whole-file editor transport stays bounded until partial document editing exists. */
export const MAX_EDITOR_FILE_BYTES = 8 * 1024 * 1024;

export function exceedsEditorReadLimit(size: number): boolean {
  return Number.isFinite(size) && size > MAX_EDITOR_FILE_BYTES;
}

export function isEditorReadLimitError(error: unknown): boolean {
  return String(error).includes('FILE_TOO_LARGE:');
}

export const EDITOR_READ_LIMIT_MESSAGE =
  `This file is too large to edit in Zync (${MAX_EDITOR_FILE_BYTES / (1024 * 1024)} MiB limit). It was not loaded. Use another editor for now.`;
