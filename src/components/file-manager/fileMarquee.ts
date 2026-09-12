export type MarqueeRect = { left: number; top: number; width: number; height: number };

export const MARQUEE_DRAG_THRESHOLD_PX = 4;

export function normalizeClientRect(x0: number, y0: number, x1: number, y1: number): MarqueeRect {
  const left = Math.min(x0, x1);
  const top = Math.min(y0, y1);
  return { left, top, width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

export function clientRectsIntersect(
  a: MarqueeRect,
  b: { left: number; top: number; width: number; height: number },
): boolean {
  return a.left < b.left + b.width
    && a.left + a.width > b.left
    && a.top < b.top + b.height
    && a.top + a.height > b.top;
}

export function namesBetween(files: { name: string }[], from: string, to: string): string[] {
  const start = files.findIndex((file) => file.name === from);
  const end = files.findIndex((file) => file.name === to);
  if (start < 0 && end < 0) return [];
  if (start < 0) return [to];
  if (end < 0) return [from];
  const lo = Math.min(start, end);
  const hi = Math.max(start, end);
  return files.slice(lo, hi + 1).map((file) => file.name);
}

export function mergeMarqueeSelection(base: string[], hits: string[]): string[] {
  if (base.length === 0) return hits;
  const next = new Set(base);
  for (const name of hits) next.add(name);
  return Array.from(next);
}

export function namesInDomMarquee(root: HTMLElement, marquee: MarqueeRect): string[] {
  const names: string[] = [];
  for (const node of root.querySelectorAll('[id^="file-item-"]')) {
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    if (!clientRectsIntersect(marquee, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    })) continue;
    const name = node.id.slice('file-item-'.length);
    if (name) names.push(name);
  }
  return names;
}

export function listNamesInMarquee(
  files: { name: string }[],
  rowHeight: number,
  listTop: number,
  listLeft: number,
  listWidth: number,
  scrollTop: number,
  marquee: MarqueeRect,
): string[] {
  if (files.length === 0 || rowHeight <= 0 || listWidth <= 0) return [];
  if (marquee.left + marquee.width <= listLeft || marquee.left >= listLeft + listWidth) return [];
  const top = marquee.top - listTop + scrollTop;
  const bottom = top + marquee.height;
  const start = Math.max(0, Math.floor(top / rowHeight));
  const end = Math.min(files.length - 1, Math.floor((bottom - 1) / rowHeight));
  if (end < start) return [];
  return files.slice(start, end + 1).map((file) => file.name);
}

export function gridNamesInMarquee(
  files: { name: string }[],
  columnCount: number,
  columnWidth: number,
  rowHeight: number,
  gridLeft: number,
  gridTop: number,
  scrollTop: number,
  marquee: MarqueeRect,
): string[] {
  if (files.length === 0 || columnCount < 1 || columnWidth <= 0 || rowHeight <= 0) return [];
  const left = marquee.left - gridLeft;
  const right = left + marquee.width;
  const top = marquee.top - gridTop + scrollTop;
  const bottom = top + marquee.height;
  const cols = Math.max(1, columnCount);
  const c0 = Math.max(0, Math.floor(left / columnWidth));
  const c1 = Math.min(cols - 1, Math.floor((right - 1) / columnWidth));
  const r0 = Math.max(0, Math.floor(top / rowHeight));
  const r1 = Math.floor((bottom - 1) / rowHeight);
  const names: string[] = [];
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const file = files[row * cols + col];
      if (file) names.push(file.name);
    }
  }
  return names;
}
