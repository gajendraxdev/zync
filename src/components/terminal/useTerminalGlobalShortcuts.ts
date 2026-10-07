import { useEffect, useRef, type RefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { terminalCache } from '../../lib/terminal/terminalCache';
import { registerTerminalInteraction } from '../../lib/terminal/terminalInteraction';

export interface UseTerminalGlobalShortcutsOptions {
  isVisible: boolean;
  isKeyboardOwner: boolean;
  sessionId: string;
  termRef: RefObject<XTerm | null>;
  onOpenSearch: () => void;
}

/** Bind this mounted terminal to host actions without broadcasting clipboard data. */
export function useTerminalGlobalShortcuts({
  isVisible, isKeyboardOwner, sessionId, termRef, onOpenSearch,
}: UseTerminalGlobalShortcutsOptions) {
  const state = useRef({ isVisible, isKeyboardOwner, onOpenSearch });
  state.current = { isVisible, isKeyboardOwner, onOpenSearch };
  useEffect(() => {
    const term = termRef.current;
    if (!term?.element) return;
    const unregister = registerTerminalInteraction({
      root: term.element,
      isAvailable: () => state.current.isVisible && termRef.current === term
        && terminalCache.get(sessionId)?.term === term && Boolean(terminalCache.get(sessionId)?.spawned),
      epoch: () => terminalCache.get(sessionId)?.generation,
      selection: () => term.getSelection(),
      paste: text => term.paste(text),
      focus: () => term.focus(),
      find: () => state.current.onOpenSearch(),
    });
    // Explicit snippet UI focus request still addresses the selected visible pane.
    const focus = () => {
      if (state.current.isVisible && state.current.isKeyboardOwner) term.focus();
    };
    window.addEventListener('ssh-ui:term-focus', focus);
    return () => {
      unregister();
      window.removeEventListener('ssh-ui:term-focus', focus);
    };
  }, [sessionId, termRef, isVisible]);
}
