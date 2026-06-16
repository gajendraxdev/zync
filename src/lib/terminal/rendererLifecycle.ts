import type { Terminal } from '@xterm/xterm';
import type { TerminalRendererState } from './types.js';

let canvasAddonImport: Promise<typeof import('@xterm/addon-canvas')> | null = null;

export function disposeWebglAddonInternal(state: TerminalRendererState): void {
  if (!state.webglAddon) return;
  try {
    state.webglAddon.dispose();
  } catch (error) {
    console.warn('[terminal] Failed to dispose WebGL addon', error);
  }
  state.webglAddon = undefined;
  state.kind = 'canvas';
}

export function disposeCanvasAddonInternal(state: TerminalRendererState): void {
  if (!state.canvasAddon) return;
  try {
    state.canvasAddon.dispose();
  } catch (error) {
    console.warn('[terminal] Failed to dispose canvas addon', error);
  }
  state.canvasAddon = undefined;
}

export function refreshTerminalScreen(term: Terminal): void {
  try {
    const lastRow = Math.max(0, term.rows - 1);
    term.refresh(0, lastRow);
  } catch {
    // Ignore refresh failures during renderer transitions.
  }
}

async function loadCanvasRenderer(term: Terminal, state: TerminalRendererState): Promise<void> {
  if (state.canvasAddon) return;

  if (!canvasAddonImport) {
    canvasAddonImport = import('@xterm/addon-canvas');
  }
  const { CanvasAddon } = await canvasAddonImport;
  const addon = new CanvasAddon();
  term.loadAddon(addon);
  state.canvasAddon = addon;
}

/**
 * Switches away from WebGL to an explicit canvas renderer and redraws the buffer.
 * Required after WebGL dispose — the default DOM renderer can leave the screen blank.
 */
export async function activateCanvasRenderer(
  term: Terminal,
  state: TerminalRendererState,
): Promise<void> {
  const hadWebgl = Boolean(state.webglAddon);
  disposeWebglAddonInternal(state);
  state.desiredKind = 'canvas';
  state.kind = 'canvas';

  if (hadWebgl) {
    disposeCanvasAddonInternal(state);
    try {
      await loadCanvasRenderer(term, state);
    } catch (error) {
      console.warn('[terminal] Canvas renderer unavailable after WebGL dispose', error);
    }
  }

  refreshTerminalScreen(term);
  if (typeof requestAnimationFrame !== 'undefined') {
    requestAnimationFrame(() => {
      refreshTerminalScreen(term);
    });
  }
}

export function ensureCanvasRenderer(state: TerminalRendererState): void {
  disposeWebglAddonInternal(state);
  state.desiredKind = 'canvas';
  state.kind = 'canvas';
}

export function disposeTerminalRenderer(state: TerminalRendererState | undefined): void {
  if (!state) return;
  if (state.loadPromise) {
    void state.loadPromise.finally(() => {
      disposeWebglAddonInternal(state);
      disposeCanvasAddonInternal(state);
    });
    state.loadPromise = null;
  } else {
    disposeWebglAddonInternal(state);
    disposeCanvasAddonInternal(state);
  }
}