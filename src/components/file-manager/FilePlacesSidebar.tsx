import { Clock, Cloud, Disc, HardDrive, Home, Pin, Plus, Server, Settings, Usb, X } from 'lucide-react';
import { memo, useState, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { ContextMenu, type ContextMenuItem } from '../ui/ContextMenu';
import { FILE_RECENT_LIMIT_CHOICES, clampFileRecentLimit } from './fileChrome';
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
      label: recentEnabled ? 'Hide Recent' : 'Show Recent',
      action: () => onRecentEnabledChange?.(!recentEnabled),
    },
    {
      label: 'Keep',
      children: FILE_RECENT_LIMIT_CHOICES.map((count) => ({
        label: `${count === keep ? '✓ ' : ''}${count} folders`,
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
      className="flex h-full w-full min-w-0 flex-col"
      onContextMenu={(event) => {
        event.preventDefault();
        openPlacesMenu(event.clientX, event.clientY);
      }}
    >
      <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
        <PlaceButton
          label="Home"
          active={inHome}
          icon={<Home size={14} />}
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
        {recentEnabled && recentRows.length > 0 && (
          <>
            <SectionLabel>Recent</SectionLabel>
            {recentRows.map((path) => (
              <PlaceButton
                key={path}
                label={filePathLeafLabel(path, { homePath: home })}
                active={isFilePathEqual(path, current)}
                icon={<Clock size={14} />}
                onClick={() => onNavigate(path)}
              />
            ))}
          </>
        )}
        <div
          className={cn(
            'mt-1 flex min-h-[7.5rem] flex-1 flex-col rounded-lg',
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
              active={isFilePathEqual(normalizeFilePath(path), current)}
              icon={<Pin size={14} />}
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
            <span className="ml-3 truncate text-[10px] font-medium uppercase tracking-wider opacity-80">
              {bookmarked ? 'Unpin' : 'Pin folder'}
            </span>
          </button>
        </div>
      </nav>
      <div className="flex shrink-0 justify-end px-2 pb-1.5">
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-md text-app-muted/70 hover:bg-app-surface/50 hover:text-app-text"
          aria-label="Places settings"
          title="Places settings"
          onClick={(event) => {
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            openPlacesMenu(rect.right - 8, rect.bottom + 4);
          }}
        >
          <Settings size={13} />
        </button>
      </div>
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
      className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-app-muted/70"
      onContextMenu={onContextMenu}
    >
      {children}
    </div>
  );
}

function volumeKindIcon(kind: FileVolume['kind']) {
  if (kind === 'removable') return <Usb size={14} />;
  if (kind === 'optical') return <Disc size={14} />;
  if (kind === 'network') return <Cloud size={14} />;
  if (kind === 'linux') return <Server size={14} />;
  return <HardDrive size={14} />;
}

function PlaceButton({
  label,
  icon,
  active,
  onClick,
  onRemove,
  title,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
  title?: string;
}) {
  return (
    <div
      className={cn(
        'group flex items-center rounded-lg border border-transparent transition-colors duration-150',
        active ? 'bg-app-surface/50 text-app-text' : 'text-app-muted hover:border-app-border/20 hover:bg-app-surface/40 hover:text-app-text',
      )}
    >
      <button
        type="button"
        title={title}
        className="flex min-w-0 flex-1 items-center px-3 py-1.5 text-left"
        onClick={onClick}
      >
        <span className="shrink-0 opacity-70">{icon}</span>
        <span className="ml-3 truncate text-[12px] font-medium">{label}</span>
      </button>
      {onRemove && (
        <button
          type="button"
          className="mr-1 flex h-6 w-6 items-center justify-center rounded-md text-app-muted opacity-0 hover:bg-app-surface/60 hover:text-app-text focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
