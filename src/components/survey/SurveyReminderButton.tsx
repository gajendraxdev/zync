import { MessageSquare } from 'lucide-react';

import { ZPortal } from '../ui/ZPortal';

interface SurveyReminderButtonProps {
  visible: boolean;
  onClick: () => void;
}

export function SurveyReminderButton({ visible, onClick }: SurveyReminderButtonProps) {
  if (!visible) return null;

  return (
    <ZPortal passive className="absolute inset-0 z-[80]">
      <div className="pointer-events-none absolute bottom-12 right-4 max-w-[calc(100%-2rem)]">
        <button
          type="button"
          onClick={onClick}
          className="pointer-events-auto inline-flex h-9 max-w-full items-center gap-2 rounded-full border border-app-border bg-app-panel px-3 text-xs font-medium text-app-text shadow-xl transition-colors hover:border-app-accent/45 hover:bg-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/60 animate-in fade-in slide-in-from-bottom-2 duration-200"
          aria-label="Open the optional Zync survey"
        >
          <MessageSquare size={14} className="shrink-0 text-app-accent" aria-hidden />
          <span className="truncate">
            <span className="hidden sm:inline">Help improve Zync</span>
            <span className="sm:hidden">Feedback</span>
          </span>
          <span className="h-2 w-2 shrink-0 rounded-full bg-app-accent" aria-hidden />
        </button>
      </div>
    </ZPortal>
  );
}
