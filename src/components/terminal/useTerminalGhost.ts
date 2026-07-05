import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { InputTracker } from '../../lib/ghostSuggestions/inputTracker';
import {
  acceptGhostCommand,
  commitGhostCommand,
  resolveInlineSuggestion,
} from '../../lib/ghostSuggestions/client';
import { bindGhostTrackerRuntime, handleGhostInputEvent } from '../../lib/ghostSuggestions/runtime';
import type { AppSettings } from '../../store/settingsSlice';
import {
  clearTerminalPendingInput,
  enqueueTerminalInputTask,
  queueTerminalInput,
  isTerminalIdleSuspended,
  spawnTerminalFromStoreContext,
  terminalCache,
} from '../../lib/terminal';
import type { TerminalMountContext } from './useTerminalLifecycle';

export interface UseTerminalGhostOptions {
  sessionId: string;
  terminalKey: string;
  spawnConnectionId: string;
  ghostScope: string;
  ghostSettings: AppSettings['ghostSuggestions'];
  isVisibleRef: RefObject<boolean>;
  isConnectedRef: RefObject<boolean>;
}

export function useTerminalGhost({
  sessionId,
  terminalKey,
  spawnConnectionId,
  ghostScope,
  ghostSettings,
  isVisibleRef,
  isConnectedRef,
}: UseTerminalGhostOptions) {
  const [ghostSuggestion, setGhostSuggestion] = useState('');
  const ghostTrackerRef = useRef<InputTracker | null>(null);
  const ghostSettingsRef = useRef(ghostSettings);

  useEffect(() => {
    ghostSettingsRef.current = ghostSettings;
    if (!ghostSettings.inlineEnabled) {
      setGhostSuggestion('');
      ghostTrackerRef.current?.clearSuggestion();
    }
  }, [ghostSettings]);

  const acceptGhostSuffix = useCallback((suffix: string) => {
    if (!suffix) return;
    const cached = terminalCache.get(sessionId);
    cached?.ghostTracker?.appendToLineBuffer(suffix);
    cached?.ghostTracker?.clearSuggestion();
    queueTerminalInput(sessionId, suffix);
    acceptGhostCommand(cached?.ghostTracker?.getLineBuffer() ?? '', ghostScope).catch(() => {});
    setGhostSuggestion('');
  }, [sessionId, ghostScope]);

  const truncateLabel = useCallback((label: string, max = 60) => {
    if (label.length <= max) return label;
    return `${label.slice(0, Math.max(0, max - 1))}…`;
  }, []);

  const resetGhostUi = useCallback(() => {
    setGhostSuggestion('');
  }, []);

  const initGhostTracker = useCallback((termSessionId: string) => {
    const ghostTracker = new InputTracker({
      onLineChange: () => {},
      onAccept: () => {},
      onDismiss: () => {},
      onHistoryCommit: () => {},
    });
    terminalCache.get(termSessionId)!.ghostTracker = ghostTracker;
  }, []);

  const onBindMount = useCallback(({ term, sessionId: mountSessionId }: TerminalMountContext) => {
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
          const termState = useAppStore.getState().terminals[terminalKey]?.find((t) => t.id === mountSessionId);
          const cwd = termState?.lastKnownCwd ?? termState?.initialPath;
          return resolveInlineSuggestion({
            line,
            cwd,
            scope: ghostScope,
            providers: ghostSettingsRef.current.providers,
          });
        },
        onSuggestion: (suffix) => {
          if (ghostSettingsRef.current.inlineEnabled) {
            setGhostSuggestion(suffix);
          } else {
            setGhostSuggestion('');
          }
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
        },
      })
      : () => {};

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
            const idleSuspended = isTerminalIdleSuspended(mountSessionId);
            console.log(
              idleSuspended
                ? '[Terminal] Idle-suspended shell, resuming on Enter'
                : '[Terminal] Session ended, restarting on Enter',
            );
            clearTerminalPendingInput(mountSessionId);
            cached.lastResize = null;
            cached.spawnBlocked = false;
            const store = useAppStore.getState();
            spawnTerminalFromStoreContext({
              sessionId: mountSessionId,
              connectionId: spawnConnectionId,
              terminalKey,
              term,
              clearBuffer: !idleSuspended,
              terminals: store.terminals,
              windowsShell: store.settings.localTerm?.windowsShell,
              remoteReady: true,
            });
            cached.ghostTracker?.reset();
            setGhostSuggestion('');
            return;
          }

          if (isVisibleRef.current) {
            const handledByGhost = handleGhostInputEvent(data, cached?.ghostTracker);
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
    isVisibleRef,
    isConnectedRef,
  ]);

  return {
    ghostSuggestion,
    acceptGhostSuffix,
    truncateLabel,
    resetGhostUi,
    initGhostTracker,
    onBindMount,
  };
}