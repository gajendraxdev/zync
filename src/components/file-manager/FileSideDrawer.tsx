import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function FileSideDrawer({
  open,
  width,
  side,
  children,
}: {
  open: boolean;
  width: number;
  side: 'left' | 'right';
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
        'absolute inset-y-0 z-40 flex flex-col overflow-hidden',
        'bg-app-panel/90 backdrop-blur-xl',
        'transition-[width,opacity] duration-300 ease-in-out',
        isLeft ? 'left-0 border-r border-app-border/40' : 'right-0 left-auto border-l border-app-border/40',
        open
          ? cn(
              'opacity-100 pointer-events-auto',
              isLeft ? 'shadow-[16px_0_32px_-8px_rgba(0,0,0,0.3)]' : 'shadow-[-16px_0_32px_-8px_rgba(0,0,0,0.3)]',
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
