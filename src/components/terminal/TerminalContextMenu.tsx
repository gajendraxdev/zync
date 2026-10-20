import { memo, useCallback, useEffect, type RefObject } from 'react';
import { Copy, Clipboard as ClipboardIcon, Trash2, Scissors, FolderOpen } from 'lucide-react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { ContextMenu } from '../ui/ContextMenu';
import { canDockHere, openFilesHere, openHerePlacementItems, pickFilesOpenPath } from '../layout/tabDock';
import type { AppSettings } from '../../store/settingsSlice';
import { useAppStore } from '../../store/useAppStore';
import { terminalCache } from '../../lib/terminal';
import {
  writeTerminalClipboardText,
} from '../../lib/terminal/terminalClipboard.js';
import { pasteIntoTerminal, terminalInteractionForElement } from '../../lib/terminal/terminalInteraction';
import type { TerminalMenuPosition } from '../../lib/terminal/terminalMouseBinding';

export interface TerminalContextMenuProps {
  position: TerminalMenuPosition;
  connectionId: string;
  sessionId: string;
  ghostSettings: AppSettings['ghostSuggestions'];
  ghostSuggestion: string;
  termRef: RefObject<XTerm | null>;
  truncateLabel: (label: string, max?: number) => string;
  onAcceptGhostSuffix: (suffix: string) => void;
  onClose: () => void;
}

export const TerminalContextMenu = memo(function TerminalContextMenu({
  position,
  connectionId,
  sessionId,
  ghostSettings,
  ghostSuggestion,
  termRef,
  truncateLabel,
  onAcceptGhostSuffix,
  onClose,
}: TerminalContextMenuProps) {
  useEffect(() => {
    const root = termRef.current?.element;
    const document = root?.ownerDocument;
    const view = document?.defaultView;
    // Host-owned clicks stop before shared menu dismissal. A sibling terminal
    // must still dismiss this menu before handling its own mouse/keyboard action.
    /** Dismiss without returning focus when another registered terminal takes ownership. */
    const dismissForSibling = (event: Event) => {
      const element = event.target instanceof Element ? event.target : null;
      const sibling = terminalInteractionForElement(element);
      if (sibling && sibling.root !== root) onClose();
    };
    view?.addEventListener('mousedown', dismissForSibling, true);
    document?.addEventListener('focusin', dismissForSibling, true);
    return () => {
      view?.removeEventListener('mousedown', dismissForSibling, true);
      document?.removeEventListener('focusin', dismissForSibling, true);
    };
  }, [onClose, termRef]);
  /** Keyboard dismissal returns focus unless an action or outside click already moved it. */
  const closeMenu = useCallback(() => {
    onClose();
    // Return keyboard focus only when it still belongs to this menu, never after
    // an outside click or an action that deliberately moved it to another pane.
    const root = termRef.current?.element;
    const active = root?.ownerDocument.activeElement;
    if (position.keyboard && active?.closest('.context-menu-container') && root?.isConnected) termRef.current?.focus();
  }, [onClose, position.keyboard, termRef]);
  const ghostItems = ghostSettings.contextMenuEnabled && ghostSuggestion
    ? [
      {
        label: truncateLabel(
          `Accept suggestion: ${terminalCache.get(sessionId)?.ghostTracker?.getLineBuffer() ?? ''}${ghostSuggestion}`,
        ),
        action: () => onAcceptGhostSuffix(ghostSuggestion),
      },
      { separator: true as const },
    ]
    : [];

  return (
    <ContextMenu
      x={position.x}
      y={position.y}
      onClose={closeMenu}
      autoFocus={position.keyboard}
      ariaLabel="Terminal actions"
      items={[
        {
          label: terminalCache.get(sessionId)?.ghostPaused ? 'Resume Zync suggestions' : 'Pause Zync suggestions',
          action: () => {
            const cached = terminalCache.get(sessionId);
            if (!cached) return;
            cached.ghostPaused = !cached.ghostPaused;
            cached.ghostContextEpoch = (cached.ghostContextEpoch ?? 0) + 1;
            cached.ghostTracker?.suspend();
          },
        },
        ...ghostItems,
        {
          label: 'Copy',
          icon: <Copy className="w-4 h-4" />,
          action: () => {
            const selection = termRef.current?.getSelection();
            if (selection) {
              void writeTerminalClipboardText(selection).catch(console.error);
            }
          },
          disabled: !termRef.current?.hasSelection(),
        },
        {
          label: 'Paste',
          icon: <ClipboardIcon className="w-4 h-4" />,
          action: () => {
            const target = terminalInteractionForElement(termRef.current?.element ?? null);
            if (!target) return;
            target.focus();
            void pasteIntoTerminal(target).catch(() => console.warn('Terminal paste failed'));
          },
        },
        {
          label: 'Select All',
          icon: <Scissors className="w-4 h-4" />,
          action: () => termRef.current?.selectAll(),
        },
        { separator: true as const },
        {
          label: 'Open File Manager Here',
          icon: <FolderOpen className="w-4 h-4" />,
          children: openHerePlacementItems(
            () => {
              void openFilesHere(connectionId, filesPathHere(connectionId, sessionId));
            },
            (edge) => {
              void openFilesHere(connectionId, filesPathHere(connectionId, sessionId), edge, sessionId);
            },
            !canDockHere(connectionId, sessionId),
          ),
        },
        {
          label: 'Clear Terminal',
          icon: <Trash2 className="w-4 h-4" />,
          variant: 'danger',
          action: () => termRef.current?.clear(),
        },
      ]}
    />
  );
});

function filesPathHere(connectionId: string, sessionId: string): string {
  const store = useAppStore.getState();
  const term = store.terminals[connectionId]?.find((t) => t.id === sessionId);
  const connection = store.connections.find((c) => c.id === connectionId);
  return pickFilesOpenPath({
    lastKnownCwd: term?.lastKnownCwd,
    initialPath: term?.initialPath,
    homePath: connection?.homePath,
  });
}
