import { useCallback, useRef, useState } from 'react';
import type { GhostPopupState } from './types';
import {
  createClosedGhostPopupState,
  createOpenGhostPopupState,
  moveGhostPopupSelectionState,
} from './popupState';

export function useGhostPopupState() {
  const initial = createClosedGhostPopupState();
  const [ghostPopup, setGhostPopup] = useState<GhostPopupState>(() => initial);
  const ghostPopupRef = useRef<GhostPopupState>(initial);

  const closeGhostPopup = useCallback(() => {
    const next = createClosedGhostPopupState();
    ghostPopupRef.current = next;
    setGhostPopup(next);
  }, []);

  const openGhostPopup = useCallback((items: string[], anchorLine = '') => {
    const next = createOpenGhostPopupState(items, anchorLine);
    ghostPopupRef.current = next;
    setGhostPopup(next);
  }, []);

  const moveGhostPopupSelection = useCallback((delta: number) => {
    const next = moveGhostPopupSelectionState(ghostPopupRef.current, delta);
    ghostPopupRef.current = next;
    setGhostPopup(next);
  }, []);

  return {
    ghostPopup,
    ghostPopupRef,
    closeGhostPopup,
    openGhostPopup,
    moveGhostPopupSelection,
  };
}
