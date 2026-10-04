import { readTerminalClipboardText, writeTerminalClipboardText } from './terminalClipboard.js';

/** Host-owned surface only. Never exposed through plugin messages. */
export interface TerminalInteraction {
  root: HTMLElement;
  isAvailable: () => boolean;
  /** Changes when the underlying PTY/transport is replaced. */
  epoch: () => unknown;
  selection: () => string;
  paste: (text: string) => void;
  focus: () => void;
  find?: () => void;
}

const surfaces = new WeakMap<HTMLElement, TerminalInteraction>();

/** Registration follows a live xterm mount; disposal invalidates pending work. */
export function registerTerminalInteraction(target: TerminalInteraction): () => void {
  surfaces.set(target.root, target);
  return () => {
    if (surfaces.get(target.root) === target) surfaces.delete(target.root);
  };
}

export function terminalInteractionForElement(element: Element | null): TerminalInteraction | undefined {
  const root = element?.closest<HTMLElement>('.xterm');
  return root ? surfaces.get(root) : undefined;
}

export function terminalInteractionForEvent(event: KeyboardEvent): TerminalInteraction | undefined {
  for (const node of event.composedPath?.() ?? [event.target]) {
    if (!(node instanceof Element)) continue;
    const target = terminalInteractionForElement(node);
    if (target?.isAvailable()) return target;
  }
  return undefined;
}

/** Toolbar search targets a registered, visible host terminal without requiring DOM focus. */
export function openTerminalFind(element: Element | null): boolean {
  const target = terminalInteractionForElement(element);
  if (!target?.root.isConnected || !target.isAvailable() || !target.find) return false;
  target.find();
  return true;
}

/** Read asynchronously, but never redirect a paste to another owner/generation. */
export async function pasteIntoTerminal(
  target: TerminalInteraction,
  read: () => Promise<string | null> = readTerminalClipboardText,
): Promise<void> {
  if (!target.isAvailable() || surfaces.get(target.root) !== target) return;
  const ownerDocument = target.root.ownerDocument;
  const ownerWindow = ownerDocument.defaultView;
  if (!ownerWindow || ownerDocument.hidden || !target.root.isConnected || !ownerDocument.hasFocus()
    || !target.root.contains(ownerDocument.activeElement)) return;
  const epoch = target.epoch();
  let cancelled = false;
  const blur = () => { cancelled = true; };
  const visibility = () => { if (ownerDocument.hidden) cancelled = true; };
  const focus = () => {
    if (!target.root.contains(ownerDocument.activeElement)) cancelled = true;
  };
  ownerWindow.addEventListener('blur', blur);
  ownerDocument.addEventListener('focusin', focus, true);
  ownerDocument.addEventListener('visibilitychange', visibility);
  try {
    const text = await read();
    if (text && !cancelled && !ownerDocument.hidden && target.root.isConnected && ownerDocument.hasFocus()
      && target.root.contains(ownerDocument.activeElement)
      && surfaces.get(target.root) === target && target.isAvailable() && target.epoch() === epoch) {
      target.paste(text);
    }
  } finally {
    ownerWindow.removeEventListener('blur', blur);
    ownerDocument.removeEventListener('focusin', focus, true);
    ownerDocument.removeEventListener('visibilitychange', visibility);
  }
}

/** Clipboard/search operations address the event's terminal, never a tab broadcast. */
export function runTerminalInteraction(action: 'copy' | 'paste' | 'find', event: KeyboardEvent): boolean {
  const target = terminalInteractionForEvent(event);
  if (!target) return false;
  if (action === 'copy') {
    const selection = target.selection();
    if (selection) void writeTerminalClipboardText(selection).catch(() => console.warn('Terminal copy failed'));
  } else if (action === 'paste') {
    void pasteIntoTerminal(target).catch(() => console.warn('Terminal paste failed'));
  } else {
    if (!target.find) return false;
    target.find();
  }
  return true;
}
