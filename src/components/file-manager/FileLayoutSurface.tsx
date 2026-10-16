import type { ReactNode } from 'react';
import { LayoutMotionScope, useLayoutMotion } from '../ui/LayoutMotion';

function FileLayoutFrame({ children }: { children: ReactNode }) {
  const { moving } = useLayoutMotion();
  return <div className="relative flex min-h-0 min-w-0 flex-1" data-file-layout-moving={moving || undefined}>{children}</div>;
}

/** Local drawers inherit workspace motion while remaining isolated from sibling Files panes. */
export function FileLayoutSurface({ children }: { children: ReactNode }) {
  return <LayoutMotionScope><FileLayoutFrame>{children}</FileLayoutFrame></LayoutMotionScope>;
}
