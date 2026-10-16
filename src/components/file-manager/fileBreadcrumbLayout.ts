/** Width buckets keep breadcrumb changes bounded; labels truncate rather than measuring every segment. */
export type FileBreadcrumbWidth = 'narrow' | 'compact' | 'medium' | 'wide';

export function fileBreadcrumbWidth(width: number): FileBreadcrumbWidth {
  if (!Number.isFinite(width) || width < 300) return 'narrow';
  if (width < 480) return 'compact';
  if (width < 720) return 'medium';
  return 'wide';
}

/** Keep the leaf visible and every folded ancestor reachable in original hierarchical order. */
export function fileBreadcrumbLayout(count: number, width: FileBreadcrumbWidth): {
  visible: number[];
  hidden: number[];
} {
  if (!Number.isInteger(count) || count < 1) return { visible: [], hidden: [] };
  const last = count - 1;
  const visible = new Set<number>([last]);
  if (width !== 'narrow') visible.add(0);
  const parents = width === 'wide' ? 2 : width === 'medium' ? 1 : 0;
  for (let index = Math.max(0, last - parents); index < last; index++) visible.add(index);
  const indices = Array.from({ length: count }, (_, index) => index);
  return { visible: indices.filter(index => visible.has(index)), hidden: indices.filter(index => !visible.has(index)) };
}
