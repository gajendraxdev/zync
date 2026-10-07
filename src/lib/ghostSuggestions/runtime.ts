import { ghostDebug } from './ghostDebug.js';
import { InputTracker } from './inputTracker.js';

interface GhostTrackerRuntimeParams {
  tracker: InputTracker;
  debounceMs?: number;
  resolveInlineSuggestion: (line: string) => Promise<string>;
  onSuggestion: (suffix: string, line: string) => void;
  onAccept: (suffix: string, lineAfterAccept: string) => void;
  onHistoryCommit: (command: string) => void;
  onClearUI: () => void;
  /** Dynamic context gates also apply after an asynchronous provider resolves. */
  isEnabled?: () => boolean;
  getContextVersion?: () => unknown;
}

/**
 * Binds ghost tracker callbacks with debounce + stale result protection.
 * Returns an unbind function that clears timers and detaches callbacks.
 */
export function bindGhostTrackerRuntime({
  tracker,
  debounceMs = 30,
  resolveInlineSuggestion,
  onSuggestion,
  onAccept,
  onHistoryCommit,
  onClearUI,
  isEnabled = () => true,
  getContextVersion = () => 0,
}: GhostTrackerRuntimeParams): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requestSeq = 0;
  let active = true;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const clearState = () => {
    requestSeq += 1;
    clearTimer();
    tracker.clearSuggestion();
    onClearUI();
  };

  tracker.updateOptions({
    onLineChange: (line) => {
      if (!isEnabled()) {
        clearState();
        return;
      }
      tracker.clearSuggestion();
      onSuggestion('', line);
      onClearUI();
      if (tracker.isSecretInputMode()) {
        ghostDebug('runtime', { phase: 'skip-fetch', reason: 'secret-input', line });
        requestSeq += 1;
        clearTimer();
        return;
      }
      if (tracker.isDesynced()) {
        ghostDebug('runtime', { phase: 'skip-fetch', reason: 'desynced', line });
        requestSeq += 1;
        clearTimer();
        return;
      }

      requestSeq += 1;
      const seq = requestSeq;
      const contextVersion = getContextVersion();
      clearTimer();

      timer = setTimeout(async () => {
        timer = null;
        if (!active || seq !== requestSeq || tracker.getLineBuffer() !== line
          || !isEnabled() || getContextVersion() !== contextVersion) return;
        if (tracker.isDesynced()) return;

        let suffix: string;
        try {
          suffix = await resolveInlineSuggestion(line);
        } catch {
          // Provider failure must not become an unhandled rejection or prevent
          // subsequent typing from requesting a new suggestion.
          return;
        }
        if (!active || seq !== requestSeq || tracker.getLineBuffer() !== line
          || !isEnabled() || getContextVersion() !== contextVersion) return;
        if (tracker.isDesynced()) return;

        tracker.setSuggestion(suffix);
        onSuggestion(suffix, line);
      }, debounceMs);
    },
    onAccept: (suffix, lineAfterAccept) => {
      clearState();
      onAccept(suffix, lineAfterAccept);
    },
    onDismiss: () => {
      clearState();
    },
    onHistoryCommit: (command) => {
      onHistoryCommit(command);
    },
  });

  return () => {
    active = false;
    clearState();
    tracker.updateOptions({
      onLineChange: () => {},
      onAccept: () => {},
      onDismiss: () => {},
      onHistoryCommit: () => {},
    });
  };
}

/**
 * Handles inline ghost input routing (accept/dismiss keys).
 * Returns true when the event was fully handled and should NOT continue to PTY write.
 */
export function handleGhostInputEvent(
  data: string,
  tracker?: InputTracker,
): boolean {
  if (!tracker) return false;
  const { consumed } = tracker.feed(data);
  return consumed;
}
