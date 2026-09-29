/** One-based cursor coordinates for the currently open editor document. */
export interface ZyncEditorStatus {
  docId: string;
  line: number;
  column: number;
  /** Short language label, for example `typescript` or `C++`. */
  language?: string;
}

export interface ZyncEditorBridge {
  onMessage(callback: (message: { type: string; payload?: unknown }) => void): () => void;
  emitReady(payload?: { supports?: string[] }): void;
  emitChange(payload: { docId: string; content: string }): void;
  emitDirtyChange(dirty: boolean, docId: string): void;
  /** Ignored by hosts that predate editor status reporting. */
  reportStatus(status: ZyncEditorStatus): void;
  requestSave(content: string, request?: { docId?: string; requestId?: number }): void;
  requestClose(): void;
  reportError(code: string, message: string, fatal?: boolean): void;
}
