import { Loader2 } from 'lucide-react';

export function FileFloatingBar({
  loading,
  selectedCount,
  totalCount,
}: {
  loading: boolean;
  selectedCount: number;
  totalCount: number;
}) {
  if (!loading && selectedCount === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-20">
      <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-app-border/25 bg-app-panel px-2.5 py-1 text-[11px] text-app-text shadow-lg">
        {loading && <Loader2 size={12} className="animate-spin text-app-accent" />}
        {loading && <span>Loading…</span>}
        {!loading && selectedCount > 0 && (
          <span>{selectedCount} selected{totalCount > 0 ? ` of ${totalCount}` : ''}</span>
        )}
      </div>
    </div>
  );
}
