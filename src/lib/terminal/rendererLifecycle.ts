import type { Terminal } from '@xterm/xterm';
import type { TerminalRendererState } from './types.js';
import { isTerminalDomMeasurable } from './terminalFit.js';

function isWebglDisposeBenignError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('_isDisposed')
    || message.includes("Cannot read properties of undefined (reading '_isDisposed')");
}

/** Pause the public focus lifecycle before disposal so addon 0.19's blink timer cannot retain xterm. */
export function disposeWebglAddonInternal(
  state: TerminalRendererState,
  term?: Terminal,
): void {
  const addon = state.webglAddon;
  if (!addon) return;
  term ??= state.terminal;
  const textarea = term?.textarea;
  const restoreFocus = Boolean(textarea && textarea.ownerDocument.activeElement === textarea);

  // Blur stops blinking even when DECSET 12 overrides the cursorBlink option.
  // Do not alter terminal options or persist a different user preference.
  term?.blur?.();

  state.webglAddon = undefined;
  state.kind = 'dom';
  state.webglLigaturesStamp = undefined;

  let disposeFailed = false;
  try {
    // Lost GL contexts still have JS listeners/timers that need disposal.
    addon.dispose();
  } catch (err) {
    if (isWebglDisposeBenignError(err)) {
      return;
    }
    disposeFailed = true;
    console.warn('[terminal] addon dispose failed', err);
  } finally {
    const active = textarea?.ownerDocument.activeElement;
    if (restoreFocus && !state.disposed && isTerminalDomMeasurable(term)
      && (!active || active === textarea?.ownerDocument.body)) term?.focus?.();
  }

  if (disposeFailed && term) {
    void activateDomRenderer(term, state);
  }
}

export function refreshTerminalScreen(term: Terminal): void {
  try {
    const bufferLength = term.buffer?.active?.length ?? 0;
    const lastRow = Math.max(0, Math.max(term.rows - 1, bufferLength - 1));
    term.refresh(0, lastRow);
  } catch {
    // Ignore refresh failures during renderer transitions.
  }
}

/**
 * Switches away from WebGL to xterm's built-in DOM renderer and redraws the buffer.
 */
export async function activateDomRenderer(
  term: Terminal,
  state: TerminalRendererState,
): Promise<void> {
  disposeWebglAddonInternal(state, term);
  state.kind = 'dom';

  refreshTerminalScreen(term);
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      refreshTerminalScreen(term);
    });
  }
}

export function ensureDomRenderer(state: TerminalRendererState, term?: Terminal): void {
  disposeWebglAddonInternal(state, term);
  state.kind = 'dom';
}

/** Revoke pending initialization before releasing the current addon; never refocus a closed owner. */
export function disposeTerminalRenderer(
  state: TerminalRendererState | undefined,
  term?: Terminal,
): void {
  if (!state) return;
  state.disposed = true;
  state.desiredKind = 'dom';
  disposeWebglAddonInternal(state, term);
  state.terminal = undefined;
}
