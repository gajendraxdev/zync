import { InputTracker } from './inputTracker.js';
import { resolveGhostInputDispatchDecision } from './controller.js';
import type { GhostPopupState } from './types.js';

interface GhostTrackerRuntimeParams {
  tracker: InputTracker;
  debounceMs?: number;
  resolveInlineSuggestion: (line: string) => Promise<string>;
  onSuggestion: (suffix: string, line: string) => void;
  onAccept: (suffix: string, lineAfterAccept: string) => void;
  onHistoryCommit: (command: string) => void;
  onClearUI: () => void;
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
      tracker.clearSuggestion();
      onSuggestion('', line);
      onClearUI();
      requestSeq += 1;
      const seq = requestSeq;
      clearTimer();

      timer = setTimeout(async () => {
        timer = null;
        if (!active || seq !== requestSeq || tracker.getLineBuffer() !== line) return;

        const suffix = await resolveInlineSuggestion(line);
        if (!active || seq !== requestSeq || tracker.getLineBuffer() !== line) return;

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

interface HandleGhostInputParams {
  data: string;
  popup: GhostPopupState;
  tracker?: InputTracker;
  allowTabPopup?: boolean;
  onMovePopupSelection: (delta: number) => void;
  onAcceptPopupSelection: () => void;
  onDismissPopup: () => void;
  onTriggerTabPopup: (tracker: InputTracker) => Promise<void> | void;
}

/**
 * Handles ghost-specific input routing (popup controls, tab trigger, inline accept).
 * Returns true when the event was fully handled and should NOT continue to PTY write.
 */
export async function handleGhostInputEvent({
  data,
  popup,
  tracker,
  allowTabPopup = true,
  onMovePopupSelection,
  onAcceptPopupSelection,
  onDismissPopup,
  onTriggerTabPopup,
}: HandleGhostInputParams): Promise<boolean> {
  const dispatch = resolveGhostInputDispatchDecision(data, popup, Boolean(tracker), allowTabPopup);

  if (typeof dispatch.moveDelta === 'number') {
    onMovePopupSelection(dispatch.moveDelta);
    return true;
  }
  if (dispatch.acceptPopupSelection) {
    onAcceptPopupSelection();
    return true;
  }
  if (dispatch.dismissPopup) {
    onDismissPopup();
    return true;
  }
  if (dispatch.closePopupBeforeContinue) {
    onDismissPopup();
  }
  if (dispatch.triggerTabPopup && tracker) {
    await onTriggerTabPopup(tracker);
    return true;
  }
  if (dispatch.shouldFeedTracker && tracker) {
    const { consumed } = tracker.feed(data);
    if (consumed) return true;
  }

  return false;
}
