export interface PlainDocumentState {
  documentId: string;
  content: string;
  savedContent: string;
}

export function reconcilePlainDocument(
  current: PlainDocumentState,
  documentId: string,
  incomingContent: string,
): PlainDocumentState {
  if (current.documentId !== documentId) {
    return { documentId, content: incomingContent, savedContent: incomingContent };
  }
  if (current.savedContent === incomingContent) return current;

  return {
    documentId,
    // A save or refresh may finish after the user has typed more text.
    content: current.content === current.savedContent ? incomingContent : current.content,
    savedContent: incomingContent,
  };
}

export function markPlainDocumentSaved(
  current: PlainDocumentState,
  documentId: string,
  savedContent: string,
): PlainDocumentState {
  if (current.documentId !== documentId) return current;
  return { ...current, savedContent };
}
