import { ChevronLeft, ChevronRight } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import { Tooltip } from '../ui/Tooltip';
import { TopbarDropdown } from '../ui/TopbarDropdown';
import { useDismiss } from './useDismiss';

export interface FileHistoryEntry {
  label: string;
  path: string;
  index: number;
}

function NavButton({
  content,
  disabled,
  className,
  onClick,
  onMenu,
  children,
}: {
  content: string;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
  onMenu?: () => void;
  children: ReactNode;
}) {
  const timer = useRef<number | null>(null);
  const longPress = useRef(false);
  const clear = useCallback(() => {
    if (timer.current == null) return;
    window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => () => clear(), [clear]);
  return (
    <Tooltip content={content} position="bottom">
      <span
        className="inline-flex"
        onContextMenu={(e) => {
          e.preventDefault();
          if (!disabled) onMenu?.();
        }}
        onPointerDown={() => {
          if (disabled) return;
          longPress.current = false;
          timer.current = window.setTimeout(() => {
            timer.current = null;
            longPress.current = true;
            onMenu?.();
          }, 480);
        }}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={clear}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label={content}
          className={cn(
            'inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-app-muted',
            'hover:border-app-border/40 hover:bg-app-surface hover:text-app-text',
            'disabled:pointer-events-none disabled:opacity-30',
            className,
          )}
          onKeyDown={(e) => {
            if (disabled || !onMenu) return;
            if (e.key === 'ArrowDown' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
              e.preventDefault();
              onMenu();
            }
          }}
          onClick={() => {
            if (longPress.current) {
              longPress.current = false;
              return;
            }
            onClick?.();
          }}
        >
          {children}
        </button>
      </span>
    </Tooltip>
  );
}

export const FileHistoryControls = memo(function FileHistoryControls({
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  backEntries,
  forwardEntries,
  onJump,
  menuSide = 'bottom',
}: {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  backEntries: FileHistoryEntry[];
  forwardEntries: FileHistoryEntry[];
  onJump: (index: number) => void;
  compact?: boolean;
  menuSide?: 'bottom' | 'top';
}) {
  const [menu, setMenu] = useState<'back' | 'forward' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setMenu(null), []);
  useDismiss(menu != null, close, rootRef);
  const entries = menu === 'back' ? backEntries : menu === 'forward' ? forwardEntries : [];

  return (
    <div ref={rootRef} className="relative flex items-center">
      <NavButton
        content="Back"
        disabled={!canGoBack}
        onClick={onBack}
        onMenu={() => { if (backEntries.length) setMenu('back'); }}
      >
        <ChevronLeft size={14} />
      </NavButton>
      <NavButton
        content="Forward"
        disabled={!canGoForward}
        onClick={onForward}
        onMenu={() => { if (forwardEntries.length) setMenu('forward'); }}
      >
        <ChevronRight size={14} />
      </NavButton>
      {menu && entries.length > 0 && (
        <TopbarDropdown align="left" side={menuSide} widthClass="w-56" className="z-50 max-h-72 overflow-y-auto">
          {entries.map((entry) => (
            <button
              key={`${menu}-${entry.index}`}
              type="button"
              className="w-full truncate rounded-lg px-3 py-1.5 text-left text-sm text-app-text hover:bg-app-accent/10"
              onClick={() => {
                onJump(entry.index);
                setMenu(null);
              }}
            >
              {entry.label}
            </button>
          ))}
        </TopbarDropdown>
      )}
    </div>
  );
});
