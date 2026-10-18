import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { SIDEBAR_WIDTH_TRANSITION_CLASSES } from '../ui/sidebarStyles';
import { useLayoutWidthTransition } from '../ui/LayoutMotion';

/** Clip a stable-width surface while the sibling listing receives the released space. */
export function FileSideDrawer({
  open,
  width,
  side,
  overlay = false,
  children,
}: {
  open: boolean;
  width: number;
  side: 'left' | 'right';
  overlay?: boolean;
  children: ReactNode;
}) {
  const isLeft = side === 'left';
  const wasOpenRef = useRef(open);
  const triggerRef = useRef<Element | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  useLayoutWidthTransition(drawerRef, { enabled: !overlay });

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      triggerRef.current = document.activeElement;
    }
    if (!open && wasOpenRef.current) {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true });
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div
      ref={drawerRef}
      data-file-drawer={side}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden bg-app-panel',
        // Width only changes on open/close, so this does not lag window resize.
        SIDEBAR_WIDTH_TRANSITION_CLASSES,
        overlay && 'transition-[width,opacity,box-shadow]',
        overlay
          ? cn(
              'absolute inset-y-0 z-40 bg-app-panel/90 backdrop-blur-xl',
              isLeft ? 'left-0' : 'right-0 left-auto',
            )
          : 'relative z-10 shrink-0',
        !isLeft && 'items-end',
        !open && 'pointer-events-none',
        overlay && (open ? 'opacity-100' : 'opacity-0'),
        overlay && open && (isLeft ? 'shadow-[16px_0_32px_-8px_rgba(0,0,0,0.3)]' : 'shadow-[-16px_0_32px_-8px_rgba(0,0,0,0.3)]'),
      )}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div
        data-file-drawer-content=""
        className={cn('flex h-full min-h-0 shrink-0 flex-col border-app-border/40',
          isLeft ? 'border-r' : 'border-l')}
        style={{ width, minWidth: width }}
      >
        {children}
      </div>
    </div>
  );
}
