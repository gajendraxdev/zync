import { Cloud, Disc, HardDrive, Home, Pin, Plus, Server, Settings, Usb, X } from 'lucide-react';
import { memo, useState, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { FileActionMenu } from './FileActionMenu';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { Tooltip } from '../ui/Tooltip';
import { FileEntryIcon } from './FileEntryIcon';
import { FILE_PLACE_ICON_PX, FILE_RECENT_LIMIT_CHOICES, clampFileRecentLimit } from './fileChrome';
import type { DragData } from './dragDropUtils';
import { filePathLeafLabel, isFilePathEqual, normalizeFilePath } from './filePathNav';
import {
  fileVolumeDisplayLabel,
  fileVolumesSectionTitle,
  isPathInHome,
  matchingVolumePath,
  type FileVolume,
} from './fileVolumes';

export const FilePlacesSidebar = memo(function FilePlacesSidebar({
  homePath,
  currentPath,
  recents,
  bookmarks,
  volumes = [],
  platform,
  recentEnabled = true,
  recentLimit = 5,
  onNavigate,
  onAddBookmark,
  onRemoveBookmark,
  onPinPaths,
  onRecentEnabledChange,
  onRecentLimitChange,
  onClearRecent,
  showHeader = true,
}: {
  homePath: string;
  currentPath: string;
  recents: string[];
  bookmarks: string[];
  volumes?: FileVolume[];
  platform?: string;
  recentEnabled?: boolean;
  recentLimit?: number;
  onNavigate: (path: string) => void;
  onAddBookmark: () => void;
  onRemoveBookmark: (path: string) => void;
  onPinPaths?: (payload: { connectionId?: string; paths: string[] }) => void;
  onRecentEnabledChange?: (enabled: boolean) => void;
  onRecentLimitChange?: (limit: number) => void;
  onClearRecent?: () => void;
  showHeader?: boolean;
}) {
  const home = homePath ? normalizeFilePath(homePath) : '';
  const current = normalizeFilePath(currentPath);
  const keep = clampFileRecentLimit(recentLimit);
  const recentRows = recents
    .map(normalizeFilePath)
    .filter((path) => path && !isFilePathEqual(path, home))
    .slice(0, keep);
  const [placesMenu, setPlacesMenu] = useState<{ x: number; y: number } | null>(null);
  const [pinsDrop, setPinsDrop] = useState(false);
  const bookmarked = bookmarks.some((path) => isFilePathEqual(path, current));
  const inHome = isPathInHome(current, home);
  const diskVolumes = volumes.filter((volume) => volume.kind !== 'linux');
  const linuxVolumes = volumes.filter((volume) => volume.kind === 'linux');
  const activeVolume = matchingVolumePath(current, volumes, home);
  const openPlacesMenu = (x: number, y: number) => {
    setPlacesMenu({ x, y });
  };

  const placesMenuItems: ContextMenuItem[] = [
    {
      label: 'Show Recent', checked: recentEnabled,
      action: () => onRecentEnabledChange?.(!recentEnabled),
    },
    {
      label: 'Keep',
      children: FILE_RECENT_LIMIT_CHOICES.map((count) => ({
        label: `${count} folders`, checked: count === keep, checkType: 'radio',
        action: () => onRecentLimitChange?.(count),
      })),
    },
    { separator: true },
    {
      label: 'Clear Recent',
      action: () => onClearRecent?.(),
      disabled: recents.length === 0,
    },
  ];

  return (
    <aside
      aria-label="File places"
      className="flex h-full w-full min-w-0 flex-col bg-app-panel/70"
      onContextMenu={(event) => {
        event.preventDefault();
        openPlacesMenu(event.clientX, event.clientY);
      }}
    >
      <div className="flex min-h-9 shrink-0 items-center justify-between px-3 py-1">
        {showHeader ? <h2 className="text-xs font-medium text-app-muted">Places</h2> : <span />}
        <FileActionMenu label="Places settings" icon={<Settings size={14} />} iconOnly items={placesMenuItems} />
      </div>
      <nav aria-label="File locations" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain p-2 [scrollbar-gutter:stable]">
        <PlaceButton
          label="Home"
          title={home || 'Home path unavailable'}
          active={inHome}
          current={isFilePathEqual(home, current)}
          icon={<Home size={FILE_PLACE_ICON_PX} />}
          onClick={() => {
            if (home) onNavigate(home);
          }}
        />
        {diskVolumes.length > 0 && (
          <>
            <SectionLabel>{fileVolumesSectionTitle(platform)}</SectionLabel>
            {diskVolumes.map((volume) => (
              <PlaceButton
                key={volume.id || volume.path}
                label={fileVolumeDisplayLabel(volume)}
                title={volume.path}
                active={!inHome && activeVolume != null && isFilePathEqual(activeVolume, volume.path)}
                icon={volumeKindIcon(volume.kind)}
                onClick={() => onNavigate(volume.path)}
              />
            ))}
          </>
        )}
        {linuxVolumes.length > 0 && (
          <>
            <SectionLabel>Linux</SectionLabel>
            {linuxVolumes.map((volume) => (
              <PlaceButton
                key={volume.id || volume.path}
                label={fileVolumeDisplayLabel(volume)}
                title={volume.path}
                active={activeVolume != null && isFilePathEqual(activeVolume, volume.path)}
                icon={volumeKindIcon(volume.kind)}
                onClick={() => onNavigate(volume.path)}
              />
            ))}
          </>
        )}
        <div
          className={cn(
                'mt-1 flex min-h-[4rem] flex-col rounded-lg',
            pinsDrop && 'bg-app-accent/10 ring-1 ring-inset ring-app-accent/40',
          )}
          onDragEnter={(event) => {
            if (!onPinPaths) return;
            const types = Array.from(event.dataTransfer.types || []);
            if (!types.includes('application/json')) return;
            event.preventDefault();
            setPinsDrop(true);
          }}
          onDragOver={(event) => {
            if (!onPinPaths) return;
            const types = Array.from(event.dataTransfer.types || []);
            if (!types.includes('application/json')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setPinsDrop(true);
          }}
          onDragLeave={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && event.currentTarget.contains(next)) return;
            setPinsDrop(false);
          }}
          onDrop={(event) => {
            setPinsDrop(false);
            if (!onPinPaths) return;
            event.preventDefault();
            event.stopPropagation();
            try {
              const raw = event.dataTransfer.getData('application/json');
              if (!raw) return;
              const data = JSON.parse(raw) as DragData;
              const paths = Array.isArray(data.paths) && data.paths.length > 0
                ? data.paths
                : (typeof data.path === 'string' && data.path ? [data.path] : []);
              if (paths.length) onPinPaths({ connectionId: data.connectionId, paths });
            } catch {
              // ignore non-file drops
            }
          }}
        >
          <SectionLabel>Pins</SectionLabel>
          {bookmarks.map((path) => (
            <PlaceButton
              key={path}
              label={filePathLeafLabel(path, { homePath: home })}
              title={path}
              active={isFilePathEqual(normalizeFilePath(path), current)}
              icon={<FileEntryIcon file={{ name: filePathLeafLabel(path), type: 'd' }} size={FILE_PLACE_ICON_PX} />}
              onClick={() => onNavigate(normalizeFilePath(path))}
              onRemove={() => onRemoveBookmark(path)}
            />
          ))}
          <button
            type="button"
            className="flex w-full items-center rounded-lg border border-transparent px-3 py-1.5 text-left text-app-muted hover:border-app-border/20 hover:bg-app-surface/40 hover:text-app-text"
            onClick={() => {
              if (bookmarked) onRemoveBookmark(current);
              else onAddBookmark();
            }}
          >
            <span className="shrink-0 opacity-70">{bookmarked ? <Pin size={14} /> : <Plus size={14} />}</span>
            <span className="ml-2 truncate text-xs">
              {bookmarked ? 'Unpin' : 'Pin folder'}
            </span>
          </button>
        </div>
        {recentEnabled && recentRows.length > 0 && (
          <>
            <SectionLabel>Recent</SectionLabel>
            {recentRows.map((path) => (
              <PlaceButton
                key={path}
                label={filePathLeafLabel(path, { homePath: home })}
                title={path}
                active={isFilePathEqual(path, current)}
                icon={<FileEntryIcon file={{ name: filePathLeafLabel(path), type: 'd' }} size={FILE_PLACE_ICON_PX} />}
                onClick={() => onNavigate(path)}
              />
            ))}
          </>
        )}
      </nav>
      {placesMenu && (
        <ContextMenu
          x={placesMenu.x}
          y={placesMenu.y}
          onClose={() => setPlacesMenu(null)}
          items={placesMenuItems}
        />
      )}
    </aside>
  );
});

function SectionLabel({
  children,
  title,
  onContextMenu,
}: {
  children: ReactNode;
  title?: string;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  return (
    <div
      title={title}
      className="px-2 pb-1 pt-3 text-[11px] text-app-muted"
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}

function volumeKindIcon(kind: FileVolume['kind']) {
  if (kind === 'removable') return <Usb size={FILE_PLACE_ICON_PX} />;
  if (kind === 'optical') return <Disc size={FILE_PLACE_ICON_PX} />;
  if (kind === 'network') return <Cloud size={FILE_PLACE_ICON_PX} />;
  if (kind === 'linux') return <Server size={FILE_PLACE_ICON_PX} />;
  return <HardDrive size={FILE_PLACE_ICON_PX} />;
}

function PlaceButton({
  label,
  icon,
  active,
  current = active,
  onClick,
  onRemove,
  title,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  current?: boolean;
  onClick: () => void;
  onRemove?: () => void;
  title?: string;
}) {
  return (
    <div
      className={cn(
        'group flex items-center rounded-lg border border-transparent transition-colors duration-150',
        active ? (current ? 'bg-app-surface/70 text-app-text' : 'bg-app-surface/30 text-app-muted') : 'text-app-muted hover:border-app-border/20 hover:bg-app-surface/40 hover:text-app-text',
      )}
    >
      <Tooltip content={title || label} position="right" className="min-w-0 flex-1">
      <Button
        type="button" variant="ghost" size="sm" aria-current={current ? 'location' : undefined}
        className="h-8 min-w-0 justify-start px-2 text-left"
        onClick={onClick}
      >
        <span aria-hidden="true" className="shrink-0">{icon}</span>
        <span className="ml-2 truncate text-[13px]">{label}</span>
        {current && <span aria-hidden="true" className="ml-auto h-1 w-1 shrink-0 rounded-full bg-app-accent" />}
      </Button>
      </Tooltip>
      {onRemove && (
        <Tooltip content={`Remove ${label}`} position="right">
          <IconButton label={`Remove ${label}`} icon={<X size={12} />} onClick={onRemove}
            className="files-place-remove mr-1 opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100" />
        </Tooltip>
      )}
    </div>
  );
}
