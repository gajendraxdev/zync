import { memo, type RefObject } from 'react';
import { Copy, Clipboard as ClipboardIcon, Trash2, Scissors, FolderOpen } from 'lucide-react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { ContextMenu } from '../ui/ContextMenu';
import { canDockHere, filesAlreadyInSplit, openFilesHere, openHerePlacementItems, pickFilesOpenPath } from '../layout/tabDock';
import type { AppSettings } from '../../store/settingsSlice';
import { useAppStore } from '../../store/useAppStore';
import { terminalCache } from '../../lib/terminal';
import {
  writeTerminalClipboardText,
} from '../../lib/terminal/terminalClipboard.js';
import { pasteIntoTerminal, terminalInteractionForElement } from '../../lib/terminal/terminalInteraction';

export interface TerminalContextMenuProps {
  position: { x: number; y: number };
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
      onClose={onClose}
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
            !canDockHere(connectionId, filesAlreadyInSplit(connectionId)),
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
