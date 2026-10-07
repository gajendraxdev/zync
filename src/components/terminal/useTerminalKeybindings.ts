import { useCallback, useRef, type MutableRefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { queueTerminalInput } from '../../lib/terminal/inputPipeline';
import { routeTerminalKey } from '../../lib/terminal/terminalKeyRouting';

export interface UseTerminalKeybindingsOptions {
  isSearchOpenRef: MutableRefObject<boolean>;
  closeSearch: () => void;
  sessionId: string;
}

export function useTerminalKeybindings({
  isSearchOpenRef,
  closeSearch,
  sessionId,
}: UseTerminalKeybindingsOptions) {
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const attachKeybindings = useCallback((term: XTerm) => {
    term.attachCustomKeyEventHandler((e) => {
      if (!routeTerminalKey(e, bytes => queueTerminalInput(sessionIdRef.current, bytes))) return false;

      if (e.type === 'keydown' && !e.isComposing && e.key === 'Escape' && isSearchOpenRef.current) {
        closeSearch();
        term.focus();
        return false;
      }

      return true;
    });
  }, [closeSearch, isSearchOpenRef]);

  return { attachKeybindings };
}
