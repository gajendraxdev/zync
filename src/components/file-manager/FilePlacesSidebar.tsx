import { Clock, Cloud, Disc, HardDrive, Home, Pin, Plus, Server, Usb, X } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { FILE_RECENT_LIMIT } from './fileChrome';
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
  onNavigate,
  onAddBookmark,
  onRemoveBookmark,
}: {
  homePath: string;
  currentPath: string;
  recents: string[];
  bookmarks: string[];
  volumes?: FileVolume[];
  platform?: string;
  onNavigate: (path: string) => void;
  onAddBookmark: () => void;
  onRemoveBookmark: (path: string) => void;
}) {
  const home = homePath ? normalizeFilePath(homePath) : '';
  const current = normalizeFilePath(currentPath);
  const recentRows = recents
    .map(normalizeFilePath)
    .filter((path) => path && !isFilePathEqual(path, home))
    .slice(0, FILE_RECENT_LIMIT);
  const bookmarked = bookmarks.some((path) => isFilePathEqual(path, current));
  const inHome = isPathInHome(current, home);
  const diskVolumes = volumes.filter((volume) => volume.kind !== 'linux');
  const linuxVolumes = volumes.filter((volume) => volume.kind === 'linux');
  const activeVolume = matchingVolumePath(current, volumes, home);

  return (
    <aside className="flex h-full w-full min-w-0 flex-col">
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
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
        {recentRows.length > 0 && (
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
      </nav>
    </aside>
  );
});

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-app-muted/70">
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
