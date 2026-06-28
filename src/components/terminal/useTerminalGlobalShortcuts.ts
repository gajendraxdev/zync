import { useEffect, type RefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import {
  readTerminalClipboardText,
  writeTerminalClipboardText,
} from '../../lib/terminal/terminalClipboard.js';

export interface UseTerminalGlobalShortcutsOptions {
  isVisible: boolean;
  termRef: RefObject<XTerm | null>;
  onOpenSearch: () => void;
}

export function useTerminalGlobalShortcuts({
  isVisible,
  termRef,
  onOpenSearch,
}: UseTerminalGlobalShortcutsOptions) {
  useEffect(() => {
    const handleGlobalCopy = async () => {
      if (isVisible && termRef.current?.hasSelection()) {
        const selection = termRef.current.getSelection();
        if (selection) {
          await writeTerminalClipboardText(selection).catch(console.error);
        }
      }
    };

    const handleGlobalPaste = async () => {
      if (!isVisible) return;
      const text = await readTerminalClipboardText();
      if (text && termRef.current) {
        termRef.current.paste(text);
      }
    };

    const handleGlobalFind = () => {
      if (isVisible) {
        onOpenSearch();
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
  }, [isVisible, termRef, onOpenSearch]);
}