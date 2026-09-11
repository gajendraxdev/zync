import { memo, useCallback, useState, type CSSProperties, type DragEvent, type RefObject } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { cn } from '../../lib/utils';
import { useInternalFileDrag } from '../../lib/dragDrop';
import type { AppSettings } from '../../store/settingsSlice';
import type { GhostLayoutHint } from '../../lib/ghostSuggestions/cursorPosition';
import { LOCAL_TERMINAL_CONNECTION_ID } from '../../lib/terminal/connectionIds.js';
import { acceptFilePathDrag } from '../../lib/terminal/fileDropToTerminal';
import { pasteFilePathsIntoTerminal } from '../../lib/terminal/pasteFileDropToTerminal';
import { isWin32Platform } from '../../lib/terminal/spawnContext.js';
import { GhostSuggestionOverlay } from './GhostSuggestionOverlay';
import { TerminalSearchBar } from './TerminalSearchBar';
import { TerminalContextMenu } from './TerminalContextMenu';

export interface TerminalHostProps {
  containerRef: RefObject<HTMLDivElement | null>;
  termRef: RefObject<XTerm | null>;
  sessionId: string;
  terminalPadding: number;
  terminalTransparencyEnabled: boolean;
  terminalHostStyle: CSSProperties | undefined;
  layoutTransitioning: boolean;
  isSearchOpen: boolean;
  searchText: string;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSearchTextChange: (value: string) => void;
  onSearchNext: () => void;
  onSearchPrev: () => void;
  onSearchClose: () => void;
  contextMenu: { x: number; y: number } | null;
  onOpenContextMenu: (position: { x: number; y: number }) => void;
  onCloseContextMenu: () => void;
  connectionId: string;
  ghostSettings: AppSettings['ghostSuggestions'];
  ghostSuggestion: string;
  ghostLayout?: GhostLayoutHint | null;
  truncateLabel: (label: string, max?: number) => string;
  onAcceptGhostSuffix: (suffix: string) => void;
}

export const TerminalHost = memo(function TerminalHost({
  containerRef,
  termRef,
  sessionId,
  terminalPadding,
  terminalTransparencyEnabled,
  terminalHostStyle,
  layoutTransitioning,
  isSearchOpen,
  searchText,
  searchInputRef,
  onSearchTextChange,
  onSearchNext,
  onSearchPrev,
  onSearchClose,
  contextMenu,
  onOpenContextMenu,
  onCloseContextMenu,
  connectionId,
  ghostSettings,
  ghostSuggestion,
  ghostLayout,
  truncateLabel,
  onAcceptGhostSuffix,
}: TerminalHostProps) {
  const fileDragActive = useInternalFileDrag();
  const [fileDropHover, setFileDropHover] = useState(false);
  const windowsPaths = connectionId === LOCAL_TERMINAL_CONNECTION_ID && isWin32Platform();

  const handleFileDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!acceptFilePathDrag(e)) return;
    setFileDropHover(true);
  }, []);

  const handleFileDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setFileDropHover(false);
  }, []);

  const handleFileDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    setFileDropHover(false);
    if (!acceptFilePathDrag(e)) return;
    e.stopPropagation();
    pasteFilePathsIntoTerminal(sessionId, e.dataTransfer, windowsPaths);
  }, [sessionId, windowsPaths]);

  return (
    <div
      key="connected"
      className={cn(
        'h-full w-full min-h-0 min-w-0 relative group outline-none',
        terminalTransparencyEnabled ? 'terminal-transparent' : 'bg-app-bg',
        fileDropHover && 'ring-2 ring-inset ring-app-accent/80',
      )}
      style={terminalHostStyle}
      tabIndex={-1}
    >
      <TerminalSearchBar
        isOpen={isSearchOpen}
        searchText={searchText}
        inputRef={searchInputRef}
        onSearchTextChange={onSearchTextChange}
        onNext={onSearchNext}
        onPrev={onSearchPrev}
        onClose={onSearchClose}
      />

      {contextMenu && (
        <TerminalContextMenu
          position={contextMenu}
          connectionId={connectionId}
          sessionId={sessionId}
          ghostSettings={ghostSettings}
          ghostSuggestion={ghostSuggestion}
          termRef={termRef}
          truncateLabel={truncateLabel}
          onAcceptGhostSuffix={onAcceptGhostSuffix}
          onClose={onCloseContextMenu}
        />
      )}

      <div
        className={cn(
          'absolute inset-0 pointer-events-none',
          layoutTransitioning && 'overflow-hidden',
        )}
        style={{
          padding: `${Math.max(0, terminalPadding)}px`,
        }}
      >
        <div className="relative h-full w-full">
          <div
            ref={containerRef}
            className="h-full w-full terminal-container pointer-events-auto"
            onClick={() => termRef.current?.focus()}
            onContextMenu={(e) => {
              e.preventDefault();
              onOpenContextMenu({ x: e.clientX, y: e.clientY });
            }}
          />
          {termRef.current && ghostSettings.inlineEnabled && ghostSuggestion && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <GhostSuggestionOverlay
                term={termRef.current}
                suggestion={ghostSuggestion}
                layout={ghostLayout}
              />
            </div>
          )}
        </div>
      </div>
      {fileDragActive && (
        <div
          className={cn(
            'absolute inset-0 z-30 pointer-events-auto',
            fileDropHover && 'bg-app-accent/10',
          )}
          onDragOver={handleFileDragOver}
          onDragLeave={handleFileDragLeave}
          onDrop={handleFileDrop}
        />
      )}
    </div>
  );
});
