import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import { terminalCache } from '../../lib/terminal/terminalCache';
import { registerTerminalInteraction } from '../../lib/terminal/terminalInteraction';
import { bindTerminalMouse, type TerminalCopyPosition, type TerminalMenuPosition } from '../../lib/terminal/terminalMouseBinding';
import type { TerminalMousePreferences } from '../../lib/terminal/terminalMousePolicy';

export interface UseTerminalGlobalShortcutsOptions {
  isVisible: boolean;
  isKeyboardOwner: boolean;
  sessionId: string;
  termRef: RefObject<XTerm | null>;
  onOpenSearch: () => void;
  mousePreferences: TerminalMousePreferences;
  onOpenContextMenu: (position: TerminalMenuPosition) => void;
}

/** Bind this mounted terminal to host actions without broadcasting clipboard data. */
export function useTerminalGlobalShortcuts({
  isVisible, isKeyboardOwner, sessionId, termRef, onOpenSearch, mousePreferences, onOpenContextMenu,
}: UseTerminalGlobalShortcutsOptions) {
  const state = useRef({ isVisible, isKeyboardOwner, onOpenSearch, mousePreferences, onOpenContextMenu });
  state.current = { isVisible, isKeyboardOwner, onOpenSearch, mousePreferences, onOpenContextMenu };
  const [copied, setCopied] = useState<TerminalCopyPosition | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (mousePreferences.copyOnSelect === true) return;
    clearTimeout(noticeTimer.current);
    setCopied(null);
  }, [mousePreferences.copyOnSelect]);
  useEffect(() => {
    setCopied(null);
    const term = termRef.current;
    if (!term?.element) return;
    const target = {
      root: term.element,
      isAvailable: () => state.current.isVisible && termRef.current === term
        && terminalCache.get(sessionId)?.term === term && Boolean(terminalCache.get(sessionId)?.spawned),
      epoch: () => terminalCache.get(sessionId)?.generation,
      selection: () => term.getSelection(),
      /** xterm applies bracketed-paste mode and routes input through the existing onData pipeline. */
      paste: (text: string) => term.paste(text),
      focus: () => term.focus(),
      find: () => state.current.onOpenSearch(),
    };
    const unregister = registerTerminalInteraction(target);
    const unbindMouse = bindTerminalMouse(term, target, () => state.current.mousePreferences,
      position => state.current.onOpenContextMenu(position), {
        /** Replace the previous feedback deadline; never accumulate timers across copies. */
        onCopied: position => {
          clearTimeout(noticeTimer.current);
          setCopied(position);
          noticeTimer.current = setTimeout(() => setCopied(null), 1200);
        },
      });
    // Explicit snippet UI focus request still addresses the selected visible pane.
    const focus = () => {
      if (state.current.isVisible && state.current.isKeyboardOwner) term.focus();
    };
    window.addEventListener('ssh-ui:term-focus', focus);
    return () => {
      clearTimeout(noticeTimer.current);
      unbindMouse();
      unregister();
      window.removeEventListener('ssh-ui:term-focus', focus);
    };
  }, [sessionId, termRef, isVisible]);
  return { copied: isVisible && mousePreferences.copyOnSelect === true ? copied : null };
}
