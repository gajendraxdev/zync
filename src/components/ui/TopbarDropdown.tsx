import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/utils';

export function TopbarDropdown({
  children,
  align = 'left',
  side = 'bottom',
  widthClass = 'w-48',
  className,
  ...props
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  side?: 'bottom' | 'top';
  widthClass?: string;
  className?: string;
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn(
        "absolute bg-app-panel border border-app-border rounded-xl shadow-2xl z-50 overflow-hidden animate-in fade-in duration-200 p-1",
        side === 'top' ? 'bottom-full mb-2 slide-in-from-bottom-2' : 'top-full mt-2 slide-in-from-top-2',
        widthClass,
        align === 'right' ? 'right-0' : 'left-0',
        className,
      )}
    >
      {children}
    </div>
  );
}
