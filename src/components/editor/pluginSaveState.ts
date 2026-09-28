/** Tracks the host's save baseline without assuming every provider sends edit contents. */
export class PluginSaveState {
  savedContent: string;
  lastContent: string;
  dirty = false;
  private contentUnknown = false;

  constructor(content: string) {
    this.savedContent = content;
    this.lastContent = content;
  }

  reset(content: string): void {
    this.savedContent = content;
    this.lastContent = content;
    this.contentUnknown = false;
    this.dirty = false;
  }

  refreshIfClean(content: string): void {
    if (!this.dirty) this.reset(content);
  }

  change(content: unknown): boolean {
    if (typeof content !== 'string') {
      this.contentUnknown = true;
      this.dirty = true;
    } else {
      this.lastContent = content;
      this.contentUnknown = false;
      this.dirty = content !== this.savedContent;
    }
    return this.dirty;
  }

  providerDirtyChange(dirty: boolean): boolean {
    // A provider can report clean before the host has committed a save.
    // Only a matching content snapshot or an updated save baseline can prove
    // that the host has no unsaved changes.
    if (dirty && !this.dirty) this.contentUnknown = true;
    this.dirty = dirty || this.contentUnknown || this.lastContent !== this.savedContent;
    return this.dirty;
  }

  requestSave(content: unknown): string {
    if (typeof content === 'string') {
      this.lastContent = content;
      this.contentUnknown = false;
      if (content !== this.savedContent) this.dirty = true;
      return content;
    }
    return this.lastContent;
  }

  saveSucceeded(content: string, providerAcknowledges: boolean): boolean {
    this.savedContent = content;
    // Providers with acknowledgements report their own current dirty state.
    // Their edits after requestSave may not include content snapshots.
    if (!providerAcknowledges) {
      this.dirty = this.contentUnknown || this.lastContent !== content;
    }
    return this.dirty;
  }

  saveFailed(content: string): boolean {
    this.dirty = this.dirty || this.contentUnknown ||
      this.lastContent !== this.savedContent || content !== this.savedContent;
    return this.dirty;
  }
}
