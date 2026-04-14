import type { GhostPopupKeyAction, GhostPopupState } from './types';

export function resolvePopupKeyAction(
  data: string,
  popup: GhostPopupState,
): GhostPopupKeyAction | null {
  if (!popup.visible || popup.items.length === 0) return null;

  if (data === '\t' || data === '\x1b[B' || data === '\x1bOB') return { kind: 'next' };
  if (data === '\x1b[A' || data === '\x1bOA') return { kind: 'prev' };
  if (data === '\r' || data === '\x1b[C' || data === '\x1bOC') return { kind: 'accept' };
  if (data === '\x03' || data === '\x04' || data === '\x1b') return { kind: 'dismiss' };

  return { kind: 'close_and_pass' };
}

export interface PopupInteractionDecision {
  consumed: boolean;
  moveDelta?: number;
  acceptSelection?: boolean;
  dismissOnly?: boolean;
  closeAndPass?: boolean;
}

export function resolvePopupInteractionDecision(
  data: string,
  popup: GhostPopupState,
): PopupInteractionDecision {
  const action = resolvePopupKeyAction(data, popup);
  if (!action) return { consumed: false };

  if (action.kind === 'next') return { consumed: true, moveDelta: 1 };
  if (action.kind === 'prev') return { consumed: true, moveDelta: -1 };
  if (action.kind === 'accept') return { consumed: true, acceptSelection: true };
  if (action.kind === 'dismiss') return { consumed: true, dismissOnly: true };
  return { consumed: false, closeAndPass: true };
}

export interface GhostInputDispatchDecision {
  moveDelta?: number;
  acceptPopupSelection?: boolean;
  dismissPopup?: boolean;
  closePopupBeforeContinue?: boolean;
  triggerTabPopup?: boolean;
  shouldFeedTracker: boolean;
}

/**
 * Centralized ghost-input routing decision for Terminal onData handling.
 */
export function resolveGhostInputDispatchDecision(
  data: string,
  popup: GhostPopupState,
  hasTracker: boolean,
  allowTabPopup = true,
): GhostInputDispatchDecision {
  const popupDecision = resolvePopupInteractionDecision(data, popup);
  if (popupDecision.consumed) {
    const out: GhostInputDispatchDecision = { shouldFeedTracker: false };
    if (typeof popupDecision.moveDelta === 'number') out.moveDelta = popupDecision.moveDelta;
    if (popupDecision.acceptSelection) out.acceptPopupSelection = true;
    if (popupDecision.dismissOnly) out.dismissPopup = true;
    return out;
  }

  if (popupDecision.closeAndPass) {
    return {
      closePopupBeforeContinue: true,
      triggerTabPopup: false,
      shouldFeedTracker: hasTracker,
    };
  }

  if (allowTabPopup && data === '\t' && hasTracker) {
    return {
      triggerTabPopup: true,
      shouldFeedTracker: false,
    };
  }

  return {
    shouldFeedTracker: hasTracker,
  };
}
