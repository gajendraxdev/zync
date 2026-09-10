import { ChevronRight, Home, Monitor } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import { filePathDisplayCrumbs } from './filePathNav';

export const FilePathBar = memo(function FilePathBar({
  currentPath,
  homePath,
  osName,
  onNavigate,
  onEditLocation,
}: {
  currentPath: string;
  homePath?: string;
  osName?: string;
  onNavigate: (path: string) => void;
  onEditLocation: () => void;
}) {
  const crumbs = filePathDisplayCrumbs(currentPath, { homePath, osName });
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
  }, [currentPath]);

  return (
    <div
      className="flex h-full min-w-0 flex-1 cursor-text items-center overflow-hidden rounded-md bg-app-bg/45 px-1 animate-in fade-in duration-150"
      onClick={() => onEditLocation()}
    >
      <div
        ref={scrollerRef}
        className="no-scrollbar flex min-w-0 flex-1 items-center overflow-x-auto"
      >
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <div
              key={`${crumb.path}-${index}`}
              className={cn('flex min-w-0 items-center', isLast && 'flex-1')}
            >
              {index > 0 && (
                <ChevronRight size={12} className="mx-0.5 shrink-0 text-app-muted/35" />
              )}
              <button
                type="button"
                aria-label={crumb.label}
                aria-current={isLast ? 'location' : undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isLast) onEditLocation();
                  else onNavigate(crumb.path);
                }}
                className={cn(
                  'inline-flex max-w-[10rem] items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[12px] leading-5',
                  isLast
                    ? 'max-w-none min-w-0 flex-1 font-medium text-app-text'
                    : 'shrink-0 text-app-muted hover:bg-app-surface/70 hover:text-app-text',
                )}
              >
                {crumb.kind === 'home' && <Home size={12} className="shrink-0 opacity-80" />}
                {crumb.kind === 'os' && <Monitor size={12} className="shrink-0 opacity-80" />}
                <span className="truncate">{crumb.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
});
