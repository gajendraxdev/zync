import type { Terminal } from '@xterm/xterm';
import {
  activateDomRenderer,
  disposeWebglAddonInternal,
} from './rendererLifecycle.js';
import { isTerminalDomMeasurable } from './terminalFit.js';
import {
  resolveDesiredTerminalRenderer,
  type TerminalRendererPreferences,
} from './rendererPolicy.js';
import { getTerminalRendererState } from './rendererSession.js';
import type { TerminalRendererKind, TerminalRendererState } from './types.js';
import { isWebgl2Available } from './webglCapability.js';

let webglAddonImport: Promise<typeof import('@xterm/addon-webgl')> | null = null;

function notifyTerminalRendererChanged(sessionId: string): void {
  if (typeof window === 'undefined') return;
  const state = getTerminalRendererState(sessionId);
  window.dispatchEvent(new CustomEvent('zync:terminal-renderer-changed', {
    detail: { sessionId, kind: state.kind, desiredKind: state.desiredKind },
  }));
}

export interface SyncTerminalRendererOptions extends TerminalRendererPreferences {
  onRefit?: () => void;
}

function shouldAbortWebglLoad(state: TerminalRendererState): boolean {
  return state.desiredKind !== 'webgl' || state.webglContextLossBlocked;
}

async function loadWebglRenderer(
  sessionId: string,
  term: Terminal,
  state: TerminalRendererState,
  onRefit?: () => void,
): Promise<TerminalRendererKind> {
  if (state.webglAddon) {
    state.kind = 'webgl';
    return 'webgl';
  }

  if (shouldAbortWebglLoad(state)) {
    return 'dom';
  }

  if (!isWebgl2Available()) {
    state.initFailureCount += 1;
    state.lastError = 'webgl2_unavailable';
    await activateDomRenderer(term, state);
    return 'dom';
  }

  try {
    if (!webglAddonImport) {
      webglAddonImport = import('@xterm/addon-webgl');
    }
    const { WebglAddon } = await webglAddonImport;
    if (shouldAbortWebglLoad(state)) {
      return 'dom';
    }

    const addon = new WebglAddon();

    addon.onContextLoss(() => {
      console.warn('[terminal] WebGL context lost — falling back to DOM for this session');
      state.contextLossCount += 1;
      state.webglContextLossBlocked = true;
      state.lastError = 'webgl_context_lost';
      state.kind = 'dom';
      disposeWebglAddonInternal(state, term, { contextAlreadyLost: true });

      // Panel hidden (Files/Dashboard) uses display:none — DOM recovery here can
      // wipe scrollback. Defer until the terminal host has measurable layout.
      if (!isTerminalDomMeasurable(term)) {
        notifyTerminalRendererChanged(sessionId);
        return;
      }

      void (async () => {
        await activateDomRenderer(term, state);
        onRefit?.();
        notifyTerminalRendererChanged(sessionId);
      })();
    });

    if (shouldAbortWebglLoad(state)) {
      addon.dispose();
      return 'dom';
    }

    term.loadAddon(addon);
    state.webglAddon = addon;
    state.kind = 'webgl';
    state.lastError = undefined;
    return 'webgl';
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[terminal] WebGL renderer unavailable, using DOM', error);
    state.initFailureCount += 1;
    state.lastError = message;
    await activateDomRenderer(term, state);
    return 'dom';
  }
}

/**
 * Applies the renderer implied by user settings and session constraints.
 * Idempotent: no-op when the active renderer already matches the target.
 */
export async function syncTerminalRenderer(
  sessionId: string,
  term: Terminal,
  options: SyncTerminalRendererOptions,
): Promise<TerminalRendererKind> {
  const rendererState = getTerminalRendererState(sessionId);
  const desired = resolveDesiredTerminalRenderer({
    gpuAcceleration: options.gpuAcceleration,
    webglContextLossBlocked: rendererState.webglContextLossBlocked,
  });

  rendererState.desiredKind = desired;

  if (desired === 'dom') {
    if (
      rendererState.kind === 'dom'
      && !rendererState.webglAddon
      && !rendererState.loadPromise
    ) {
      notifyTerminalRendererChanged(sessionId);
      return 'dom';
    }

    let transitionPromise!: Promise<TerminalRendererKind>;
    transitionPromise = (async (): Promise<TerminalRendererKind> => {
      const priorLoad = rendererState.loadPromise;
      try {
        if (priorLoad) {
          try {
            await priorLoad;
          } catch {
            // Force DOM even if the prior renderer transition failed.
          }
        }
        await activateDomRenderer(term, rendererState);
        options.onRefit?.();
        notifyTerminalRendererChanged(sessionId);
        return 'dom';
      } catch (error) {
        console.warn('[terminal] DOM transition failed', error);
        return 'dom';
      } finally {
        if (rendererState.loadPromise === transitionPromise) {
          rendererState.loadPromise = null;
        }
      }
    })();
    rendererState.loadPromise = transitionPromise;
    return transitionPromise;
  }

  if (rendererState.kind === 'webgl' && rendererState.webglAddon) {
    notifyTerminalRendererChanged(sessionId);
    return 'webgl';
  }

  if (rendererState.loadPromise) {
    if (rendererState.kind === rendererState.desiredKind) {
      return rendererState.loadPromise;
    }
  }

  rendererState.loadPromise = (async () => {
    try {
      const kind = await loadWebglRenderer(sessionId, term, rendererState, options.onRefit);
      notifyTerminalRendererChanged(sessionId);
      if (kind === 'webgl') {
        options.onRefit?.();
      }
      return kind;
    } catch (error) {
      console.warn('[terminal] WebGL transition failed', error);
      return 'dom';
    } finally {
      rendererState.loadPromise = null;
    }
  })();

  return rendererState.loadPromise;
}

/**
 * Disposes and reloads the WebGL addon so ligature font-feature-settings apply to the
 * texture atlas. No-op when GPU is blocked or WebGL is unavailable.
 */
export function reactivateTerminalWebgl(
  sessionId: string,
  term: Terminal,
  options: Pick<SyncTerminalRendererOptions, 'onRefit'> = {},
): Promise<TerminalRendererKind> {
  const rendererState = getTerminalRendererState(sessionId);
  if (rendererState.webglContextLossBlocked) {
    notifyTerminalRendererChanged(sessionId);
    return Promise.resolve('dom');
  }

  if (rendererState.loadPromise) {
    return rendererState.loadPromise;
  }

  rendererState.loadPromise = (async (): Promise<TerminalRendererKind> => {
    try {
      disposeWebglAddonInternal(rendererState, term, {
        contextAlreadyLost: rendererState.webglContextLossBlocked,
      });

      if (!isWebgl2Available()) {
        rendererState.initFailureCount += 1;
        rendererState.lastError = 'webgl2_unavailable';
        await activateDomRenderer(term, rendererState);
        notifyTerminalRendererChanged(sessionId);
        return 'dom';
      }

      const kind = await loadWebglRenderer(sessionId, term, rendererState, options.onRefit);
      notifyTerminalRendererChanged(sessionId);
      if (kind === 'webgl') {
        options.onRefit?.();
      }
      return kind;
    } finally {
      rendererState.loadPromise = null;
    }
  })();

  return rendererState.loadPromise;
}