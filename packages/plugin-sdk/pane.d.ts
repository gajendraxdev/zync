export interface ZyncPaneApi {
  pane: {
    postMessage(message: unknown): void;
    onMessage(callback: (message: unknown) => void): () => void;
    /** Optional on older hosts. Hidden panes should suspend automatic reads. */
    isVisible?(): boolean;
    onVisibilityChange?(callback: (visible: boolean) => void): () => void;
  };
}
