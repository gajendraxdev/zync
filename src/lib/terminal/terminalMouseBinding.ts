import type { Terminal } from '@xterm/xterm';
import { writeTerminalClipboardText } from './terminalClipboard.js';
import { pasteIntoTerminal, terminalInteractionForElement, type TerminalInteraction } from './terminalInteraction.js';
import { resolveTerminalRightClick, type TerminalMousePreferences } from './terminalMousePolicy.js';

export interface TerminalMenuPosition { x: number; y: number; keyboard?: boolean }
export interface TerminalCopyPosition { x: number; y: number }

/** Bind mouse ownership to an existing host interaction; no synthetic PTY input or private xterm APIs. */
export function bindTerminalMouse(
  term: Terminal,
  target: TerminalInteraction,
  preferences: () => TerminalMousePreferences,
  openMenu: (position: TerminalMenuPosition) => void,
  { writeClipboard = writeTerminalClipboardText, onCopied }: {
    writeClipboard?: (text: string) => Promise<void>;
    onCopied?: (position: TerminalCopyPosition) => void;
  } = {},
): () => void {
  const root = target.root;
  const document = root.ownerDocument;
  const view = document.defaultView;
  let disposed = false;
  let gestureVersion = 0;
  let rightPress: { action: ReturnType<typeof resolveTerminalRightClick>; epoch: unknown; handled: boolean; button: number } | null = null;
  let selecting: { epoch: unknown; changed: boolean; x: number; y: number } | null = null;
  /** Hidden, detached, unregistered and replaced transports cannot receive clipboard actions. */
  const available = () => !disposed && root.isConnected && !document.hidden && document.hasFocus()
    && target.isAvailable() && terminalInteractionForElement(root) === target;
  /** Claim host-owned events before xterm or the WebView can also act on them. */
  const consume = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  /** Confirm an automatic copy before showing feedback; stale completions cannot label a different selection. */
  const copy = (event: MouseEvent) => {
    const text = target.selection();
    if (!text) return;
    const version = gestureVersion;
    const epoch = target.epoch();
    const rect = root.getBoundingClientRect();
    const position = {
      x: Math.max(rect.left + 28, Math.min(event.clientX, rect.right - 28)),
      y: Math.max(rect.top + 36, Math.min(event.clientY, rect.bottom)),
    };
    void writeClipboard(text).then(() => {
      if (version === gestureVersion && available() && target.epoch() === epoch
        && root.contains(document.activeElement) && preferences().copyOnSelect === true) onCopied?.(position);
    }).catch(() => console.warn('Terminal copy failed'));
  };
  /** Invalidate unfinished gestures when focus, visibility or surface ownership changes. */
  const reset = () => { gestureVersion++; rightPress = null; selecting = null; };
  const selection = term.onSelectionChange(() => { if (selecting) selecting.changed = true; });

  /** Latch one action and transport generation before xterm handles a new mouse gesture. */
  const press = (event: MouseEvent) => {
    if (!root.contains(event.target as Node)) { reset(); return; }
    if (!available()) return;
    reset();
    const mac = view?.navigator.platform.toUpperCase().includes('MAC');
    const secondary = event.button === 2 || (event.button === 0 && event.ctrlKey && mac);
    const canSelect = term.modes.mouseTrackingMode === 'none'
      || (mac ? event.altKey && term.options.macOptionClickForcesSelection : event.shiftKey);
    selecting = !secondary && event.button === 0 && canSelect && preferences().copyOnSelect === true
      ? { epoch: target.epoch(), changed: false, x: event.clientX, y: event.clientY } : null;
    if (!secondary) return;
    rightPress = {
      action: resolveTerminalRightClick(preferences(), term.modes.mouseTrackingMode !== 'none', event.shiftKey),
      epoch: target.epoch(), handled: false, button: event.button,
    };
    if (rightPress.action !== 'pass') {
      consume(event);
      target.focus();
    }
  };
  /** Suppress the matching release of a host-owned right click, including outside-pane releases. */
  const releaseCapture = (event: MouseEvent) => {
    // xterm registers mouseup on document during mouse reporting. Claim the whole
    // host-owned gesture before that listener, including releases outside the pane.
    if (rightPress && event.button === rightPress.button && rightPress.action !== 'pass') consume(event);
  };
  /** Copy once after xterm finalizes a user mouse selection; ordinary updates do not copy. */
  const releaseSelection = (event: MouseEvent) => {
    if (event.button !== 0) return;
    const gesture = selecting;
    selecting = null;
    // Reselecting the same range need not emit a new xterm selection event.
    const selected = gesture && (gesture.changed || gesture.x !== event.clientX || gesture.y !== event.clientY);
    if (selected && preferences().copyOnSelect === true && available()
      && root.contains(document.activeElement) && target.epoch() === gesture.epoch) copy(event);
  };
  /** Execute the latched action once while keeping the native WebView menu suppressed. */
  const contextMenu = (event: MouseEvent) => {
    consume(event); // Never expose the WebView's native menu, even in pass-through mode.
    if (!available()) return;
    const gesture = rightPress ?? {
      action: resolveTerminalRightClick(preferences(), term.modes.mouseTrackingMode !== 'none', event.shiftKey),
      epoch: target.epoch(), handled: false,
    };
    if (gesture.handled || target.epoch() !== gesture.epoch) return;
    gesture.handled = true;
    if (gesture.action === 'pass') return;
    target.focus();
    if (gesture.action === 'menu') openMenu({ x: event.clientX, y: event.clientY });
    else void pasteIntoTerminal(target).catch(() => console.warn('Terminal paste failed'));
  };
  /** Reserve menu keys before xterm translation and absorb any duplicate native contextmenu event. */
  const key = (event: KeyboardEvent) => {
    const menuKey = event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey);
    if (!menuKey || event.isComposing || event.defaultPrevented || !available()) return;
    consume(event);
    if (event.type !== 'keydown' || event.repeat) return;
    reset();
    rightPress = { action: 'menu', epoch: target.epoch(), handled: true, button: -1 };
    const rect = root.getBoundingClientRect();
    openMenu({ x: rect.left + 12, y: rect.top + 12, keyboard: true });
  };
  /** A gesture begun before the document was hidden cannot complete on its return. */
  const visibility = () => { if (document.hidden) reset(); };
  // Capture before xterm's target listeners. The window release runs after
  // xterm's document listener finalizes selection,
  // irrespective of registration order, without timers or intermediate copies.
  document.addEventListener('mousedown', press, true);
  document.addEventListener('mouseup', releaseCapture, true);
  view?.addEventListener('mouseup', releaseSelection);
  root.addEventListener('contextmenu', contextMenu, true);
  root.addEventListener('keydown', key, true);
  root.addEventListener('keyup', key, true);
  view?.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    disposed = true;
    reset();
    selection.dispose();
    document.removeEventListener('mousedown', press, true);
    document.removeEventListener('mouseup', releaseCapture, true);
    view?.removeEventListener('mouseup', releaseSelection);
    root.removeEventListener('contextmenu', contextMenu, true);
    root.removeEventListener('keydown', key, true);
    root.removeEventListener('keyup', key, true);
    view?.removeEventListener('blur', reset);
    document.removeEventListener('visibilitychange', visibility);
  };
}
