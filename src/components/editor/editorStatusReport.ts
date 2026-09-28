export interface EditorStatusReport {
  docId: string;
  line: number;
  column: number;
  language?: string;
}

const MAX_POSITION = 10_000_000;
const LANGUAGE_PATTERN = /^[a-zA-Z0-9_+#.-]{1,32}$/;

/** Ignore stale, malformed, or unbounded status data from an editor iframe. */
export function parseEditorStatusReport(payload: unknown, expectedDocId: string): EditorStatusReport | null {
  if (!payload || typeof payload !== 'object') return null;
  const value = payload as Record<string, unknown>;
  if (value.docId !== expectedDocId) return null;
  if (!Number.isSafeInteger(value.line) || (value.line as number) < 1 || (value.line as number) > MAX_POSITION) return null;
  if (!Number.isSafeInteger(value.column) || (value.column as number) < 1 || (value.column as number) > MAX_POSITION) return null;
  if (value.language !== undefined &&
    (typeof value.language !== 'string' || !LANGUAGE_PATTERN.test(value.language))) return null;
  return {
    docId: expectedDocId,
    line: value.line as number,
    column: value.column as number,
    language: value.language as string | undefined,
  };
}

/** Textarea selection offsets are UTF-16, matching the browser's cursor model. */
export function plainCursorPosition(content: string, selectionStart: number): { line: number; column: number } {
  const end = Math.max(0, Math.min(content.length, selectionStart));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < end; index += 1) {
    if (content.charCodeAt(index) === 10) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}
