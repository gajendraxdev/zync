import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

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

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      triggerRef.current = document.activeElement;
    }
    if (!open && wasOpenRef.current) {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      if (trigger instanceof HTMLElement) trigger.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden bg-app-panel',
        // Width only changes on open/close, so this does not lag window resize.
        overlay
          ? 'transition-[width,opacity,box-shadow] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
          : 'transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
        overlay
          ? cn(
              'absolute inset-y-0 z-40 bg-app-panel/90 backdrop-blur-xl',
              isLeft ? 'left-0' : 'right-0 left-auto',
            )
          : 'relative z-10 shrink-0',
        isLeft ? 'border-r border-app-border/40' : 'border-l border-app-border/40',
        !open && 'border-transparent',
        open
          ? cn(
              'opacity-100 pointer-events-auto',
              overlay && (isLeft ? 'shadow-[16px_0_32px_-8px_rgba(0,0,0,0.3)]' : 'shadow-[-16px_0_32px_-8px_rgba(0,0,0,0.3)]'),
            )
          : 'opacity-0 pointer-events-none',
      )}
      style={{ width: open ? width : 0 }}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      {children}
    </div>
  );
}
