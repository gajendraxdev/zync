import { useEffect, useRef, useState, useCallback, memo } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useAppStore, Connection } from '../../store/useAppStore';
import { Search, ArrowUp, ArrowDown, X, Copy, Clipboard as ClipboardIcon, Trash2, Scissors } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ContextMenu } from '../ui/ContextMenu';
import { Button } from '../ui/Button';
import { Terminal } from 'lucide-react';

import { InputTracker } from '../../lib/ghostSuggestions/inputTracker';
import {
  acceptGhostCommand,
  commitGhostCommand,
  resolveInlineSuggestion,
  resolvePopupCandidates,
  resolveTabCompletionOutcome,
  shouldPreferPathSuggestion,
} from '../../lib/ghostSuggestions/client';
import type { GhostTabState } from '../../lib/ghostSuggestions/types';
import { createInitialGhostTabState, resetGhostTabState } from '../../lib/ghostSuggestions/tabState';
import { bindGhostTrackerRuntime } from '../../lib/ghostSuggestions/runtime';
import { handleGhostInputEvent } from '../../lib/ghostSuggestions/runtime';
import { useGhostPopupState } from '../../lib/ghostSuggestions/uiState';
import { GhostSuggestionOverlay } from './GhostSuggestionOverlay';
import { GhostSuggestionListOverlay } from './GhostSuggestionListOverlay';
import { useTerminalTheme } from './useTerminalTheme';
import { useTerminalLifecycle } from './useTerminalLifecycle';
import {
  clearTerminalPendingInput,
  enqueueTerminalInputTask,
  queueTerminalInput,
  spawnTerminalFromStoreContext,
  terminalCache,
} from '../../lib/terminal';

interface TerminalComponentProps {
  connectionId?: string;
  termId?: string;
  isVisible?: boolean;
  isWorkspaceActive?: boolean;
  isTerminalView?: boolean;
  isActiveTab?: boolean;
}

function terminalPropsEqual(prev: TerminalComponentProps, next: TerminalComponentProps): boolean {
  return prev.connectionId === next.connectionId
    && prev.termId === next.termId
    && prev.isVisible === next.isVisible
    && prev.isWorkspaceActive === next.isWorkspaceActive
    && prev.isTerminalView === next.isTerminalView
    && prev.isActiveTab === next.isActiveTab;
}

export const TerminalComponent = memo(function TerminalComponent({
  connectionId,
  termId,
  isVisible,
  isWorkspaceActive = true,
  isTerminalView = true,
  isActiveTab = true,
}: TerminalComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  // Search State
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [ghostSuggestion, setGhostSuggestion] = useState('');
  const {
    ghostPopup,
    ghostPopupRef,
    closeGhostPopup,
    openGhostPopup,
    moveGhostPopupSelection,
  } = useGhostPopupState();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const ghostTabStateRef = useRef<GhostTabState>(createInitialGhostTabState());
  const ghostTrackerRef = useRef<InputTracker | null>(null);

  // Search handlers
  const handleNext = useCallback(() => {
    searchAddonRef.current?.findNext(searchText);
  }, [searchText]);

  const handlePrev = useCallback(() => {
    searchAddonRef.current?.findPrevious(searchText);
  }, [searchText]);

  const handleClose = useCallback(() => {
    setIsSearchOpen(false);
    setSearchText('');
    termRef.current?.focus();
  }, []);

  const globalActiveId = useAppStore(state => state.activeConnectionId);
  const connections = useAppStore(state => state.connections);
  const connect = useAppStore(state => state.connect);
  const settings = useAppStore(state => state.settings);
  const updateSettings = useAppStore(state => state.updateSettings);
  const ghostSettings = settings.ghostSuggestions;
  const ghostSettingsRef = useRef(ghostSettings);
  const terminalSettingsRef = useRef(settings.terminal);

  useEffect(() => {
    ghostSettingsRef.current = ghostSettings;
    if (!ghostSettings.inlineEnabled) {
      setGhostSuggestion('');
      ghostTrackerRef.current?.clearSuggestion();
    }
    if (!ghostSettings.popupEnabled) {
      closeGhostPopup();
      ghostTabStateRef.current = resetGhostTabState();
    }
  }, [ghostSettings, closeGhostPopup]);

  useEffect(() => {
    terminalSettingsRef.current = settings.terminal;
  }, [settings.terminal]);

  // Helper for terminal settings update if needed, though usually we update global settings
  const updateTerminalSettings = (newSettings: Partial<typeof settings.terminal>) => {
    updateSettings({ terminal: { ...terminalSettingsRef.current, ...newSettings } });
  };

  const activeConnectionId = connectionId || globalActiveId;
  const terminalKey = activeConnectionId || 'local';
  const ghostScope = connectionId || terminalKey;
  const currentFontSizeRef = useRef(settings.terminal.fontSize);

  useEffect(() => {
    currentFontSizeRef.current = settings.terminal.fontSize;
  }, [settings.terminal.fontSize]);

  // Find connection status
  const isLocal = terminalKey === 'local';
  const connection = !isLocal ? connections.find((c: Connection) => c.id === terminalKey) : null;
  const isConnected = isLocal || connection?.status === 'connected';

  // True when this tab was restored from a previous session and has never spawned a PTY yet.
  const isPendingRestore = useAppStore(state =>
    !isLocal && !!state.terminals[terminalKey]?.find(t => t.id === (termId || terminalKey))?.pendingRestore
  );

  // Use termId if provided, otherwise fallback to terminalKey
  const sessionId = termId || terminalKey;
  const spawnConnectionId = terminalKey;
  const remoteReady = isLocal || isConnected;

  // Shell-tab switch reuses one component instance — reset per-shell UI chrome (not xterm/cache).
  useEffect(() => {
    setIsSearchOpen(false);
    setSearchText('');
    setGhostSuggestion('');
    setContextMenu(null);
    closeGhostPopup();
    ghostTabStateRef.current = resetGhostTabState();
    try {
      searchAddonRef.current?.clearDecorations();
    } catch {
      // Search addon may not be bound yet on first mount.
    }
  }, [sessionId, closeGhostPopup]);

  const { terminalTransparency, terminalHostStyle, resolveInitialTheme } = useTerminalTheme({
    containerRef,
    termRef,
    settings,
    connection,
    activeConnectionId,
    sessionId,
    isConnected,
  });

  const isVisibleRef = useRef(isVisible);
  const isConnectedRef = useRef(isConnected);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    isConnectedRef.current = isConnected;
  }, [isConnected]);

  const acceptGhostSuffix = useCallback((suffix: string) => {
    if (!suffix) return;
    const cached = terminalCache.get(sessionId);
    cached?.ghostTracker?.appendToLineBuffer(suffix);
    cached?.ghostTracker?.clearSuggestion();
    queueTerminalInput(sessionId, suffix);
    acceptGhostCommand(cached?.ghostTracker?.getLineBuffer() ?? '', ghostScope).catch(() => {});
    closeGhostPopup();
    setGhostSuggestion('');
    // Reset Tab-cycle state so subsequent Tab presses start a fresh cycle.
    ghostTabStateRef.current = resetGhostTabState();
  }, [sessionId, ghostScope, closeGhostPopup]);

  const truncateLabel = useCallback((label: string, max = 60) => {
    if (label.length <= max) return label;
    return `${label.slice(0, Math.max(0, max - 1))}…`;
  }, []);

  const onCreateTerminal = useCallback((term: XTerm) => {
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown') {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('zync:ai-command-bar'));
          return false;
        }

        if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
          e.preventDefault();
          const currentSize = currentFontSizeRef.current;
          updateTerminalSettings({ fontSize: Math.min(currentSize + 1, 32) });
          return false;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === '-') {
          e.preventDefault();
          const currentSize = currentFontSizeRef.current;
          updateTerminalSettings({ fontSize: Math.max(currentSize - 1, 8) });
          return false;
        }

        if (e.key === 'Escape') {
          if (isSearchOpen) {
            setIsSearchOpen(false);
            term.focus();
            return false;
          }
        }
      }
      return true;
    });

    const ghostTracker = new InputTracker({
      onLineChange: () => {},
      onAccept: () => {},
      onDismiss: () => {},
      onHistoryCommit: () => {},
    });
    terminalCache.get(sessionId)!.ghostTracker = ghostTracker;
  }, [sessionId, isSearchOpen, updateTerminalSettings]);

  const onBindMount = useCallback(({ term, sessionId: mountSessionId }: { term: XTerm; sessionId: string; isNewTerminal: boolean }) => {
    const cachedGhostTracker = terminalCache.get(mountSessionId)?.ghostTracker;
    ghostTrackerRef.current = cachedGhostTracker ?? null;
    if (!ghostSettingsRef.current.inlineEnabled) {
      ghostTrackerRef.current?.clearSuggestion();
    }

    const unbindGhostTracker = cachedGhostTracker
      ? bindGhostTrackerRuntime({
        tracker: cachedGhostTracker,
        debounceMs: 30,
        resolveInlineSuggestion: async (line) => {
          if (!ghostSettingsRef.current.inlineEnabled) return '';
          if (!isVisibleRef.current) return '';
          const termState = useAppStore.getState().terminals[terminalKey]?.find(t => t.id === mountSessionId);
          const cwd = termState?.lastKnownCwd ?? termState?.initialPath;
          return resolveInlineSuggestion({
            line,
            cwd,
            scope: ghostScope,
            providers: ghostSettingsRef.current.providers,
          });
        },
        onSuggestion: (suffix, line) => {
          if (ghostSettingsRef.current.inlineEnabled) {
            setGhostSuggestion(suffix);
          } else {
            setGhostSuggestion('');
          }

          closeGhostPopup();

          if (!ghostSettingsRef.current.popupEnabled || line.trim().length < 2) {
            return;
          }

          const termState = useAppStore.getState().terminals[terminalKey]?.find(t => t.id === mountSessionId);
          const cwd = termState?.lastKnownCwd ?? termState?.initialPath;
          const preferPath = shouldPreferPathSuggestion(line);
          if (!isVisibleRef.current) return;
          void resolvePopupCandidates({
            line,
            cwd,
            scope: ghostScope,
            preferPath,
            limit: 10,
            providers: ghostSettingsRef.current.providers,
          }).then((items) => {
            if (!cachedGhostTracker || cachedGhostTracker.getLineBuffer() !== line) return;
            if (!ghostSettingsRef.current.popupEnabled) return;
            if (items.length > 1) openGhostPopup(items, line);
            else closeGhostPopup();
          }).catch(() => {
            closeGhostPopup();
          });
        },
        onAccept: (suffix, lineAfterAccept) => {
          queueTerminalInput(mountSessionId, suffix);
          acceptGhostCommand(lineAfterAccept, ghostScope).catch(() => {});
        },
        onHistoryCommit: (cmd) => {
          commitGhostCommand(cmd, ghostScope).catch(() => {});
        },
        onClearUI: () => {
          setGhostSuggestion('');
          closeGhostPopup();
          ghostTabStateRef.current = resetGhostTabState();
        },
      })
      : () => {};

    const triggerGhostPopup = async (tracker: InputTracker) => {
      try {
        const line = tracker.getLineBuffer();
        if (!ghostSettingsRef.current.popupEnabled) {
          queueTerminalInput(mountSessionId, '\t');
          return;
        }
        const termState = useAppStore.getState().terminals[terminalKey]?.find(t => t.id === mountSessionId);
        const cwd = termState?.lastKnownCwd ?? termState?.initialPath;
        if (!isVisibleRef.current) return;
        const outcome = await resolveTabCompletionOutcome({
          line,
          cwd,
          scope: ghostScope,
          previousTabState: ghostTabStateRef.current,
          now: Date.now(),
          limit: 24,
          providers: ghostSettingsRef.current.providers,
        });

        if (tracker.getLineBuffer() !== line) {
          ghostTabStateRef.current = resetGhostTabState();
          closeGhostPopup();
          return;
        }

        if (outcome.kind === 'accept') {
          ghostTabStateRef.current = outcome.nextState;
          acceptGhostSuffix(outcome.suffix);
          return;
        }
        if (outcome.kind === 'show_list') {
          if (!ghostSettingsRef.current.popupEnabled) {
            ghostTabStateRef.current = resetGhostTabState();
            closeGhostPopup();
            queueTerminalInput(mountSessionId, '\t');
            return;
          }
          ghostTabStateRef.current = outcome.nextState;
          openGhostPopup(outcome.items, line);
          return;
        }

        closeGhostPopup();
        ghostTabStateRef.current = resetGhostTabState();
        queueTerminalInput(mountSessionId, '\t');
      } catch (error) {
        console.warn('[Ghost] Tab popup resolution failed:', error);
        ghostTabStateRef.current = resetGhostTabState();
        closeGhostPopup();
        queueTerminalInput(mountSessionId, '\t');
      }
    };

    const cachedForInput = terminalCache.get(mountSessionId);
    if (cachedForInput?.onDataDisposable) {
      cachedForInput.onDataDisposable.dispose();
      cachedForInput.onDataDisposable = undefined;
    }

    if (cachedForInput) {
      cachedForInput.onDataDisposable = term.onData((data) => {
        enqueueTerminalInputTask(mountSessionId, async () => {
          const cached = terminalCache.get(mountSessionId);

          if (cached && !cached.spawned) {
            const isRestartKey = data === '\r' || data === '\n';
            if (!isRestartKey) {
              return;
            }
            if (!isVisibleRef.current || !isConnectedRef.current || cached.spawnBlocked) {
              return;
            }
            console.log('[Terminal] Session ended, restarting on Enter');
            clearTerminalPendingInput(mountSessionId);
            cached.lastResize = null;
            cached.spawnBlocked = false;
            const store = useAppStore.getState();
            spawnTerminalFromStoreContext({
              sessionId: mountSessionId,
              connectionId: spawnConnectionId,
              terminalKey,
              term,
              clearBuffer: true,
              terminals: store.terminals,
              windowsShell: store.settings.localTerm?.windowsShell,
              remoteReady: true,
            });
            cached.ghostTracker?.reset();
            setGhostSuggestion('');
            closeGhostPopup();
            ghostTabStateRef.current = resetGhostTabState();
            return;
          }

          if (isVisibleRef.current) {
            const handledByGhost = await handleGhostInputEvent({
              data: data,
              popup: ghostPopupRef.current,
              tracker: cached?.ghostTracker,
              allowTabPopup: ghostSettingsRef.current.popupEnabled,
              onMovePopupSelection: moveGhostPopupSelection,
              onAcceptPopupSelection: () => {
                const popup = ghostPopupRef.current;
                const suffix = popup.items[popup.selectedIndex] ?? '';
                acceptGhostSuffix(suffix);
              },
              onDismissPopup: closeGhostPopup,
              onTriggerTabPopup: triggerGhostPopup,
            });
            if (handledByGhost) return;
          }

          queueTerminalInput(mountSessionId, data);
        });
      });
    }

    return unbindGhostTracker;
  }, [
    terminalKey,
    ghostScope,
    spawnConnectionId,
    acceptGhostSuffix,
    closeGhostPopup,
    openGhostPopup,
    moveGhostPopupSelection,
  ]);

  const { layoutTransitioning } = useTerminalLifecycle({
    containerRef,
    termRef,
    fitAddonRef,
    searchAddonRef,
    activeConnectionId,
    sessionId,
    terminalKey,
    spawnConnectionId,
    isConnected,
    isVisible,
    isWorkspaceActive,
    isTerminalView,
    isActiveTab,
    remoteReady,
    terminalSettings: settings.terminal,
    resolveInitialTheme,
    onCreateTerminal,
    onBindMount,
  });
  // Handle Global Shortcuts (Copy, Paste, Find)
  useEffect(() => {
    const handleGlobalCopy = async () => {
      // Only trigger if this terminal is currently visible/active
      if (isVisible && termRef.current?.hasSelection()) {
        const selection = termRef.current.getSelection();
        if (selection) {
          try {
            const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
            await writeText(selection);
          } catch (e) {
            console.error('Tauri copy failed, falling back to navigator:', e);
            navigator.clipboard.writeText(selection).catch(console.error);
          }
        }
      }
    };

    const handleGlobalPaste = async () => {
      if (isVisible) {
        try {
          // Use Tauri plugin for robust clipboard access
          const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
          const text = await readText();
          if (text && termRef.current) {
            termRef.current.paste(text);
          }
        } catch (e) {
          console.error('Paste failed:', e);
          // Fallback to navigator (though likely to fail if plugin failed)
          try {
            const text = await navigator.clipboard.readText();
            if (text && termRef.current) termRef.current.paste(text);
          } catch (e2) {
            console.error('Fallback paste failed:', e2);
          }
        }
      }
    };

    const handleGlobalFind = () => {
      if (isVisible) {
        setIsSearchOpen(true);
        // Small delay to ensure render
        setTimeout(() => searchInputRef.current?.focus(), 50);
      }
    };

    const handleGlobalFocus = () => {
      if (isVisible) {
        termRef.current?.focus();
      }
    };

    window.addEventListener('ssh-ui:term-copy', handleGlobalCopy);
    window.addEventListener('ssh-ui:term-paste', handleGlobalPaste);
    window.addEventListener('ssh-ui:term-find', handleGlobalFind);
    window.addEventListener('ssh-ui:term-focus', handleGlobalFocus);

    return () => {
      window.removeEventListener('ssh-ui:term-copy', handleGlobalCopy);
      window.removeEventListener('ssh-ui:term-paste', handleGlobalPaste);
      window.removeEventListener('ssh-ui:term-find', handleGlobalFind);
      window.removeEventListener('ssh-ui:term-focus', handleGlobalFocus);
    };

  }, [activeConnectionId, globalActiveId, isVisible]);

  if (!activeConnectionId) return <div className="p-8 text-gray-400">Please connect to a server first.</div>;

  if (!isConnected) {
    const isConnecting = connection?.status === 'connecting';
    const hasError = connection?.status === 'error';

    return (
      <div key="disconnected" className="flex flex-col h-full items-center justify-center p-8 text-app-muted gap-4 bg-app-bg z-10 relative">
        {isConnecting ? (
          <>
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-app-accent border-t-transparent"></div>
            <span>Connecting to terminal...</span>
          </>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-app-muted gap-4">
            <div className="h-12 w-12 rounded-full bg-app-surface border border-app-border flex items-center justify-center text-app-muted/50">
              <Terminal size={24} />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-app-text mb-1">
                {hasError ? 'Connection Error' : 'Disconnected'}
              </p>
              <p className="text-xs text-app-muted mb-4 opacity-70">
                {hasError
                  ? 'Failed to establish connection. Please check credentials and try again.'
                  : isPendingRestore
                    ? 'Terminal restored from last session. Reconnect to resume.'
                    : 'The connection to this terminal was closed.'}
              </p>
              <Button onClick={() => activeConnectionId && connect(activeConnectionId)}>
                {hasError ? 'Retry Connection' : 'Reconnect'}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      key="connected"
      className={cn("h-full w-full relative group outline-none", terminalTransparency.enabled ? "terminal-transparent" : "bg-app-bg")}
      style={terminalHostStyle}
      tabIndex={-1}
      onClick={() => {
        if (termRef.current) {
          termRef.current.focus();
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }}
    >
      {/* Search Overlay */}
      <div className={cn(
        "absolute top-4 right-4 z-50 flex items-center gap-1 p-1 bg-app-panel backdrop-blur-xl border border-app-border rounded-lg shadow-xl transition-all duration-200 ease-out origin-top-right",
        isSearchOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
      )}>
        <div className="relative flex items-center">
          <Search className="absolute left-2 w-3.5 h-3.5 text-app-muted" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e) => {
              setSearchText(e.target.value);
              searchAddonRef.current?.findNext(e.target.value, { incremental: true });
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) handlePrev();
                else handleNext();
              }
              if (e.key === 'Escape') handleClose();
            }}
            placeholder="Find..."
            className="w-48 bg-transparent text-sm text-app-text placeholder:text-app-muted/50 pl-7 pr-2 py-1 focus:outline-none"
          />
        </div>

        <div className="h-4 w-[1px] bg-app-border mx-1" />

        <button
          onClick={handlePrev}
          className="p-1 hover:bg-app-surface rounded text-app-muted hover:text-app-text transition-colors"
          title="Previous (Shift+Enter)"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          onClick={handleNext}
          className="p-1 hover:bg-app-surface rounded text-app-muted hover:text-app-text transition-colors"
          title="Next (Enter)"
        >
          <ArrowDown className="w-4 h-4" />
        </button>

        <button
          onClick={handleClose}
          className="p-1 hover:bg-red-500/10 hover:text-red-400 rounded text-app-muted transition-colors ml-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          items={[
            ...(
              ghostSettings.contextMenuEnabled && ghostPopup.items.length
                ? [
                  {
                    label: 'Suggestions',
                    children: ghostPopup.items.slice(0, 8).map((suffix) => ({
                      label: truncateLabel(`${ghostPopup.anchorLine}${suffix}`),
                      action: () => {
                        acceptGhostSuffix(suffix);
                      },
                    })),
                  },
                  { separator: true as const },
                ]
                : ghostSettings.contextMenuEnabled && ghostSuggestion
                  ? [
                    {
                      label: truncateLabel(
                        `Accept suggestion: ${ghostPopup.anchorLine || (terminalCache.get(sessionId)?.ghostTracker?.getLineBuffer() ?? '')}${ghostSuggestion}`
                      ),
                      action: () => {
                        acceptGhostSuffix(ghostSuggestion);
                      },
                    },
                    { separator: true as const },
                  ]
                  : []
            ),
            {
              label: 'Copy',
              icon: <Copy className="w-4 h-4" />,
              action: () => {
                const selection = termRef.current?.getSelection();
                if (selection) navigator.clipboard.writeText(selection);
              },
              disabled: !termRef.current?.hasSelection()
            },
            {
              label: 'Paste',
              icon: <ClipboardIcon className="w-4 h-4" />,
              action: async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  if (text) termRef.current?.paste(text);
                } catch (err) {
                  console.error('Failed to paste', err);
                }
              }
            },
            {
              label: 'Select All',
              icon: <Scissors className="w-4 h-4" />,
              action: () => termRef.current?.selectAll()
            },
            {
              label: 'Clear Terminal',
              icon: <Trash2 className="w-4 h-4" />,
              variant: 'danger',
              action: () => termRef.current?.clear()
            }
          ]}
        />
      )}

      {/* Terminal Canvas Wrapper - Strict bottom padding - Always overflow-hidden during transition */}
      <div
        className={cn(
          "absolute inset-0 pointer-events-none",
          layoutTransitioning && "overflow-hidden",
        )}
        style={{
          padding: `${Math.max(0, settings.terminal.padding ?? 12)}px`,
        }}
      >
        {/*
          Wrap containerRef and the ghost overlay in a shared relative div so
          the overlay can be positioned as a sibling (not a child) of the xterm
          container. xterm.js owns the DOM inside containerRef via term.open() —
          putting React children inside it causes reconciliation conflicts.
        */}
        <div className="relative h-full w-full">
          <div ref={containerRef} className="h-full w-full terminal-container pointer-events-auto" />
          {termRef.current && ghostSettings.inlineEnabled && ghostSuggestion && !ghostPopup.visible && (
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <GhostSuggestionOverlay term={termRef.current} suggestion={ghostSuggestion} />
            </div>
          )}
          {termRef.current && ghostSettings.popupEnabled && ghostPopup.visible && ghostPopup.items.length > 0 && (
            <div className="absolute inset-0 pointer-events-none overflow-visible z-20">
              <GhostSuggestionListOverlay
                term={termRef.current}
                items={ghostPopup.items}
                selectedIndex={ghostPopup.selectedIndex}
                anchorLine={ghostPopup.anchorLine}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}, terminalPropsEqual);








