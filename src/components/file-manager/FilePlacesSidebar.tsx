import { Clock, Home, Plus, Star, X } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { FILE_RECENT_LIMIT } from './fileChrome';
import { filePathLeafLabel, isFilePathEqual, normalizeFilePath } from './filePathNav';

export const FilePlacesSidebar = memo(function FilePlacesSidebar({
  homePath,
  currentPath,
  recents,
  bookmarks,
  onNavigate,
  onAddBookmark,
  onRemoveBookmark,
}: {
  homePath: string;
  currentPath: string;
  recents: string[];
  bookmarks: string[];
  onNavigate: (path: string) => void;
  onAddBookmark: () => void;
  onRemoveBookmark: (path: string) => void;
}) {
  const home = normalizeFilePath(homePath || '/');
  const current = normalizeFilePath(currentPath);
  const recentRows = recents
    .map(normalizeFilePath)
    .filter((path) => path && !isFilePathEqual(path, home))
    .slice(0, FILE_RECENT_LIMIT);
  const bookmarked = bookmarks.some((path) => isFilePathEqual(path, current));

  return (
    <aside className="flex h-full w-full min-w-0 flex-col">
      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        <PlaceButton
          label="Home"
          active={isFilePathEqual(current, home)}
          icon={<Home size={14} />}
          onClick={() => onNavigate(home)}
        />
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
        <SectionLabel>Bookmarks</SectionLabel>
        {bookmarks.map((path) => (
          <PlaceButton
            key={path}
            label={filePathLeafLabel(path, { homePath: home })}
            active={isFilePathEqual(normalizeFilePath(path), current)}
            icon={<Star size={14} />}
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
          <span className="shrink-0 opacity-70">{bookmarked ? <Star size={14} /> : <Plus size={14} />}</span>
          <span className="ml-3 truncate text-[10px] font-medium uppercase tracking-wider opacity-80">
            {bookmarked ? 'Remove bookmark' : 'New bookmark'}
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

function PlaceButton({
  label,
  icon,
  active,
  onClick,
  onRemove,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
  onRemove?: () => void;
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
