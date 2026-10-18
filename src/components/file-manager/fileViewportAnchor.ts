/** A file identity and its row's clipped distance above the viewport. Never a stale pixel position. */
export interface FileViewportAnchor { name: string; offset: number }

export function captureFileViewportAnchor(
  files: readonly { name: string }[], columns: number, rowPitch: number, scrollTop: number,
): FileViewportAnchor | null {
  if (!files.length || columns < 1 || rowPitch <= 0) return null;
  const top = Math.max(0, scrollTop);
  const row = Math.floor(top / rowPitch);
  const index = Math.min(files.length - 1, row * columns);
  return { name: files[index].name, offset: top - row * rowPitch };
}

/** The browser clamps the result at the scroll boundaries when exact anchoring cannot fit. */
export function fileViewportAnchorTop(
  anchor: FileViewportAnchor | null, files: readonly { name: string }[], columns: number, rowPitch: number,
): number | null {
  if (!anchor || columns < 1 || rowPitch <= 0) return null;
  const index = files.findIndex(file => file.name === anchor.name);
  return index < 0 ? null : Math.max(0, Math.floor(index / columns) * rowPitch + Math.min(anchor.offset, rowPitch - 1));
}
