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
import { getTerminalRendererState, hasTerminalRendererSession } from './rendererSession.js';
import type { TerminalRendererKind, TerminalRendererState } from './types.js';
import { isWebgl2Available } from './webglCapability.js';

let webglAddonImport: Promise<typeof import('@xterm/addon-webgl')> | null = null;

/** Report only the owning live state; late callbacks must not recreate a closed session. */
function notifyTerminalRendererChanged(sessionId: string, state: TerminalRendererState): void {
  if (typeof window === 'undefined' || state.disposed) return;
  window.dispatchEvent(new CustomEvent('zync:terminal-renderer-changed', {
    detail: { sessionId, kind: state.kind, desiredKind: state.desiredKind },
  }));
}

export interface SyncTerminalRendererOptions extends TerminalRendererPreferences {
  onRefit?: () => void;
}

/** Recheck intent and lifetime across lazy imports, activation and context-loss callbacks. */
function shouldAbortWebglLoad(state: TerminalRendererState): boolean {
  return Boolean(state.disposed) || state.desiredKind !== 'webgl' || state.webglContextLossBlocked;
}

/** Install one addon for the still-live owner; partially activated addons share normal cleanup. */
async function loadWebglRenderer(
  sessionId: string,
  term: Terminal,
  state: TerminalRendererState,
  onRefit?: () => void,
): Promise<TerminalRendererKind> {
  if (shouldAbortWebglLoad(state)) return 'dom';
  if (state.webglAddon) {
    state.kind = 'webgl';
    return 'webgl';
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
      if (state.disposed || state.webglAddon !== addon) return;
      console.warn('[terminal] WebGL context lost — falling back to DOM for this session');
      state.contextLossCount += 1;
      state.webglContextLossBlocked = true;
      state.desiredKind = 'dom';
      state.lastError = 'webgl_context_lost';
      state.kind = 'dom';
      disposeWebglAddonInternal(state, term);

      // Release listeners even while hidden; defer refit until the host has real
      // geometry. Renderer disposal must not mutate the canonical scrollback.
      if (!isTerminalDomMeasurable(term)) {
        notifyTerminalRendererChanged(sessionId, state);
        return;
      }

      void transitionTerminalRenderer(sessionId, term, state, { onRefit });
    });

    if (shouldAbortWebglLoad(state)) {
      addon.dispose();
      return 'dom';
    }

    state.webglAddon = addon;
    term.loadAddon(addon);
    if (shouldAbortWebglLoad(state)) {
      disposeWebglAddonInternal(state, term);
      return 'dom';
    }
    state.kind = 'webgl';
    state.lastError = undefined;
    return 'webgl';
  } catch (error) {
    disposeWebglAddonInternal(state, term);
    if (state.disposed) return 'dom';
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[terminal] WebGL renderer unavailable, using DOM', error);
    state.initFailureCount += 1;
    state.lastError = message;
    await activateDomRenderer(term, state);
    return 'dom';
  }
}

/** One pending transition per owner; coalesce requests and settle on the latest desired renderer. */
function transitionTerminalRenderer(
  sessionId: string,
  term: Terminal,
  state: TerminalRendererState,
  options: Pick<SyncTerminalRendererOptions, 'onRefit'>,
  reactivate = false,
): Promise<TerminalRendererKind> {
  if (state.loadPromise) return state.loadPromise;
  // Start after publishing the promise: synchronous callbacks cannot open a second transition.
  const transition = Promise.resolve().then(async (): Promise<TerminalRendererKind> => {
    while (!state.disposed) {
      const desired = state.desiredKind;
      if (desired === 'dom') {
        await activateDomRenderer(term, state);
      } else {
        if (reactivate) disposeWebglAddonInternal(state, term);
        reactivate = false;
        await loadWebglRenderer(sessionId, term, state, options.onRefit);
      }
      if (state.disposed) return 'dom';
      if (state.desiredKind !== desired) continue;
      notifyTerminalRendererChanged(sessionId, state);
      if (state.disposed) return 'dom';
      if (state.desiredKind !== desired) continue;
      if (desired === 'dom' || state.kind === 'webgl') options.onRefit?.();
      if (state.disposed) return 'dom';
      if (state.desiredKind !== desired) continue;
      return state.kind;
    }
    return 'dom';
  }).catch(async (error): Promise<TerminalRendererKind> => {
    if (!state.disposed) {
      console.warn('[terminal] Renderer transition failed', error);
      try { await activateDomRenderer(term, state); } catch { /* Terminal may already be torn down. */ }
    }
    return 'dom';
  }).finally(() => {
    if (state.loadPromise === transition) state.loadPromise = null;
  });
  state.loadPromise = transition;
  return transition;
}

/**
 * Applies the renderer implied by user settings and session constraints.
 * Idempotent: no-op when the active renderer already matches the target.
 */
export function syncTerminalRenderer(
  sessionId: string,
  term: Terminal,
  options: SyncTerminalRendererOptions,
): Promise<TerminalRendererKind> {
  const rendererState = getTerminalRendererState(sessionId);
  if (rendererState.disposed || (rendererState.terminal && rendererState.terminal !== term)) {
    return Promise.resolve('dom');
  }
  rendererState.terminal = term;
  const desired = resolveDesiredTerminalRenderer({
    gpuAcceleration: options.gpuAcceleration,
    webglContextLossBlocked: rendererState.webglContextLossBlocked,
  });

  rendererState.desiredKind = desired;

  if (!rendererState.loadPromise && rendererState.kind === desired
    && (desired === 'dom' ? !rendererState.webglAddon : Boolean(rendererState.webglAddon))) {
    notifyTerminalRendererChanged(sessionId, rendererState);
    return Promise.resolve(desired);
  }
  return transitionTerminalRenderer(sessionId, term, rendererState, options);
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
  // Reactivation is for an existing owner, never a way to resurrect a closed session.
  if (!hasTerminalRendererSession(sessionId)) return Promise.resolve('dom');
  const rendererState = getTerminalRendererState(sessionId);
  if (rendererState.disposed || rendererState.webglContextLossBlocked
    || (rendererState.terminal && rendererState.terminal !== term)) {
    notifyTerminalRendererChanged(sessionId, rendererState);
    return Promise.resolve('dom');
  }

  if (rendererState.loadPromise) {
    return rendererState.loadPromise;
  }

  rendererState.terminal = term;
  rendererState.desiredKind = 'webgl';
  return transitionTerminalRenderer(sessionId, term, rendererState, options, true);
}
