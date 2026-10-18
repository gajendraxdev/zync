import { ChevronRight, HardDrive, Home, Monitor, MoreHorizontal, Pencil } from 'lucide-react';
import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';
import { filePathDisplayCrumbs } from './filePathNav';
import { fileBreadcrumbLayout, fileBreadcrumbWidth, type FileBreadcrumbWidth } from './fileBreadcrumbLayout';
import { FileActionMenu } from './FileActionMenu';
import { IconButton } from '../ui/IconButton';
import { CONTROL_INSET_FOCUS_CLASSES } from '../ui/controlStyles';
import { Tooltip } from '../ui/Tooltip';
import { FileFolderMenu } from './FileFolderMenu';
import type { FileFolderLoader } from './fileFolderOptions';

/** Named native breadcrumb navigation; one observer folds ancestors without changing path identity. */
export const FilePathBar = memo(function FilePathBar({
  currentPath,
  homePath,
  osName,
  onNavigate,
  onEditLocation,
  loadFolders,
  disabled,
}: {
  currentPath: string;
  homePath?: string;
  osName?: string;
  onNavigate: (path: string) => void;
  onEditLocation: () => void;
  loadFolders: FileFolderLoader;
  disabled?: boolean;
}) {
  const crumbs = useMemo(() => filePathDisplayCrumbs(currentPath, { homePath, osName }), [currentPath, homePath, osName]);
  const barRef = useRef<HTMLElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const pendingNavigationRef = useRef<string | null>(null);
  const [width, setWidth] = useState<FileBreadcrumbWidth>('narrow');
  const layout = fileBreadcrumbLayout(crumbs.length, width);

  useLayoutEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => {
      const next = fileBreadcrumbWidth(el.clientWidth);
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && el.contains(focused)) {
        const index = focused.closest('[data-path-index]')?.getAttribute('data-path-index');
        const nextLayout = fileBreadcrumbLayout(crumbs.length, next);
        if ((index !== null && index !== undefined && !nextLayout.visible.includes(Number(index)))
          || (focused.closest('.files-path-overflow') && nextLayout.hidden.length === 0)) {
          currentRef.current?.focus({ preventScroll: true });
        }
      }
      setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [crumbs.length]);

  useLayoutEffect(() => {
    const target = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    const bar = barRef.current;
    if (target === currentPath && bar && (document.activeElement === document.body || bar.contains(document.activeElement))) {
      currentRef.current?.focus({ preventScroll: true });
    }
  }, [currentPath]);

  const overflow = <li className="files-path-overflow flex shrink-0 items-center" key="overflow">
    {layout.visible[0] === 0 && <PathSeparator />}
    <FileActionMenu key={currentPath} label="Hidden parent folders" tooltip="Show parent folders" icon={<MoreHorizontal size={15} />} iconOnly triggerClassName={CONTROL_INSET_FOCUS_CLASSES}
      items={layout.hidden.map(index => ({ label: crumbs[index].path, action: () => {
        pendingNavigationRef.current = crumbs[index].path;
        onNavigate(crumbs[index].path);
      } }))} />
  </li>;
  const segments = layout.visible.map((index, visibleIndex) => {
    const crumb = crumbs[index];
    const isLast = index === crumbs.length - 1;
    return (
      <li key={`${crumb.path}-${index}`} data-path-index={index} className={cn('flex min-w-0 items-center', isLast ? 'flex-1' : 'max-w-[22%] shrink')}>
        {(visibleIndex > 0 || (layout.hidden.length > 0 && index > 0)) && <FileFolderMenu key={currentPath}
          parentPath={crumbs[index - 1].path} parentLabel={crumbs[index - 1].label} currentChild={crumb.path}
          loadFolders={loadFolders} disabled={disabled} onNavigate={path => { pendingNavigationRef.current = path; onNavigate(path); }} />}
        <Tooltip content={isLast ? `${currentPath} · Edit location` : crumb.path} position="bottom"
          contentClassName="max-w-[min(36rem,calc(100vw-1rem))] whitespace-normal break-all">
          <button
            type="button"
            ref={isLast ? currentRef : undefined}
            data-path-index={index}
            data-file-path-current={isLast || undefined}
            aria-label={crumb.label}
            aria-current={isLast ? 'location' : undefined}
            onClick={() => {
              if (isLast) onEditLocation();
              else onNavigate(crumb.path);
            }}
            className={cn(
              CONTROL_INSET_FOCUS_CLASSES,
              'files-path-segment inline-flex h-7 min-w-[24px] items-center gap-1.5 rounded px-2 text-[0.8125rem] hover:bg-app-surface/60 hover:text-app-text',
              isLast ? 'w-full font-semibold text-app-text' : 'max-w-32 text-app-muted',
            )}
          >
            {crumb.kind === 'home' && <Home size={14} aria-hidden="true" className="shrink-0" />}
            {crumb.kind === 'os' && <Monitor size={14} aria-hidden="true" className="shrink-0" />}
            {crumb.kind === 'drive' && <HardDrive size={14} aria-hidden="true" className="shrink-0" />}
            <span className="truncate">{crumb.label}</span>
          </button>
        </Tooltip>
      </li>
    );
  });
  // Stable sibling keys retain the overflow trigger when its position changes during resize.
  if (layout.hidden.length > 0) segments.splice(layout.visible[0] === 0 ? 1 : 0, 0, overflow);

  return (
    <nav ref={barRef} aria-label="Folder path"
      className="files-path-bar flex h-full min-w-0 flex-1 items-center rounded-md border border-app-border/60 bg-app-bg/45 px-1">
      <ol className="flex min-w-0 flex-1 items-center">{segments}</ol>
      <Tooltip content="Edit location" position="bottom">
        <IconButton label="Edit location" data-file-path-edit="" icon={<Pencil size={13} />} onClick={onEditLocation} className={cn('shrink-0', CONTROL_INSET_FOCUS_CLASSES)} />
      </Tooltip>
    </nav>
  );
});

function PathSeparator() {
  return <ChevronRight size={12} aria-hidden="true" className="mx-0.5 shrink-0 text-app-muted/50" />;
}
