import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { POPUP_SURFACE_CLASSES } from './surfaceStyles';

/** Shared popup surface; callers own actions, keyboard behavior and open state. */
export function TopbarDropdown({
  children,
  align = 'left',
  side = 'bottom',
  widthClass = 'w-48',
  className,
  anchor,
  ...props
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  side?: 'bottom' | 'top';
  widthClass?: string;
  className?: string;
  /** Optional stable trigger: portal the popup so sidebar scrolling cannot clip it. */
  anchor?: HTMLElement | null;
} & HTMLAttributes<HTMLDivElement>) {
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false });
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      if (!panel.current || !anchor.isConnected) return;
      const bounds = anchor.getBoundingClientRect();
      const popup = panel.current.getBoundingClientRect();
      const left = Math.max(8, Math.min(align === 'right' ? bounds.right - popup.width : bounds.left, window.innerWidth - popup.width - 8));
      const below = bounds.bottom + 8;
      const preferred = side === 'top' || below + popup.height > window.innerHeight - 8 ? bounds.top - popup.height - 8 : below;
      const top = Math.max(8, Math.min(preferred, window.innerHeight - popup.height - 8));
      setPosition(previous => previous.ready && previous.left === left && previous.top === top ? previous : { left, top, ready: true });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panel.current) observer.observe(panel.current);
    observer.observe(anchor);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, align, side]);
  const content = (
    <div
      {...props}
      ref={panel}
      data-submenu-owner={anchor?.id || undefined}
      style={anchor ? { ...props.style, position: 'fixed', left: position.left, top: position.top,
        maxHeight: 'calc(100vh - 16px)', visibility: position.ready ? undefined : 'hidden' } : props.style}
      className={cn(
        POPUP_SURFACE_CLASSES,
        // Placement updates must be immediate: a duration utility would animate left/top.
        'transition-none p-1',
        anchor ? 'fixed z-[99999] overflow-y-auto' : 'absolute z-50 overflow-hidden',
        !anchor && (side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'),
        widthClass,
        !anchor && (align === 'right' ? 'right-0' : 'left-0'),
        className,
      )}
    >
      {children}
    </div>
  );
  return anchor ? createPortal(content, document.body) : content;
}
