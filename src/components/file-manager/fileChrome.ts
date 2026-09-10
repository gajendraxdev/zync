/** Nautilus window breakpoint (`max-width: 682sp`). */
export const FILE_CHROME_NARROW_MAX = 682;

/** Recent folders kept per connection and shown in Places. */
export const FILE_RECENT_LIMIT = 5;

/** Places column width (`w-48`). */
export const FILE_PLACES_WIDTH_PX = 192;

/** Properties overlay width (`w-64`, same as Snippets). */
export const FILE_PROPERTIES_WIDTH_PX = 256;

export const FILE_GRID_ZOOM = [
  { minTrack: 86, gap: 6, rowHeight: 96, icon: 48 },
  { minTrack: 96, gap: 6, rowHeight: 112, icon: 64 },
  { minTrack: 108, gap: 8, rowHeight: 136, icon: 96 },
  { minTrack: 160, gap: 8, rowHeight: 200, icon: 168 },
  { minTrack: 210, gap: 10, rowHeight: 268, icon: 256 },
] as const;

export const FILE_LIST_ZOOM = [
  { icon: 16, rowHeight: 40 },
  { icon: 32, rowHeight: 52 },
  { icon: 64, rowHeight: 80 },
] as const;

export type FileClickPolicy = 'single' | 'double';

export function clampFileGridZoom(level: number): number {
  if (!Number.isFinite(level)) return 1;
  if (level < 0) return 0;
  if (level > FILE_GRID_ZOOM.length - 1) return FILE_GRID_ZOOM.length - 1;
  return Math.floor(level);
}

export function clampFileListZoom(level: number): number {
  if (!Number.isFinite(level)) return 1;
  if (level < 0) return 0;
  if (level > FILE_LIST_ZOOM.length - 1) return FILE_LIST_ZOOM.length - 1;
  return Math.floor(level);
}
