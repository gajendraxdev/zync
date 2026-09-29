export interface EditorFileTarget {
  connectionId: string;
  path: string;
}

/** A late read must not replace a newer open or cross a connection switch. */
export function isCurrentEditorRead(
  sourceConnectionId: string,
  currentConnectionId: string | null | undefined,
  requestId: number,
  currentRequestId: number,
): boolean {
  return sourceConnectionId === currentConnectionId && requestId === currentRequestId;
}
