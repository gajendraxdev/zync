import { rendererKindLabel } from './rendererPolicy.js';
import { getTerminalRendererState, hasTerminalRendererSession } from './rendererSession.js';
import type { TerminalRendererKind, TerminalRendererState } from './types.js';
import { isWebgl2Available } from './webglCapability.js';

export type TerminalRendererHealth = 'gpu-active' | 'dom-expected' | 'dom-fallback' | 'loading';

/** @deprecated Use dom-expected */
export type LegacyTerminalRendererHealth = TerminalRendererHealth | 'canvas-expected' | 'canvas-fallback';

export interface TerminalRendererDiagnostics {
  activeKind: TerminalRendererKind;
  desiredKind: TerminalRendererKind;
  label: string;
  health: TerminalRendererHealth;
  summary: string;
  detail?: string;
  webgl2Available: boolean;
}

export interface TerminalRendererDiagnosticsContext {
  gpuAcceleration: boolean;
}

function describeFallbackReason(
  state: TerminalRendererState,
  context: TerminalRendererDiagnosticsContext,
): string | undefined {
  if (!context.gpuAcceleration) {
    return 'GPU acceleration is turned off in settings.';
  }
  if (state.webglContextLossBlocked) {
    return 'WebGL context was lost in this session; using DOM until the tab is closed.';
  }
  if (state.lastError === 'webgl2_unavailable') {
    return 'WebGL2 is not available in this environment.';
  }
  if (state.lastError === 'webgl_context_lost') {
    return 'WebGL context was lost; fell back to DOM.';
  }
  if (state.lastError) {
    return `WebGL init failed: ${state.lastError}`;
  }
  if (state.loadPromise) {
    return 'WebGL renderer is still loading.';
  }
  if (state.desiredKind === 'webgl' && state.kind === 'dom') {
    return 'GPU was requested but the DOM renderer is active.';
  }
  return undefined;
}

export function describeTerminalRendererState(
  state: TerminalRendererState,
  context: TerminalRendererDiagnosticsContext,
): TerminalRendererDiagnostics {
  const label = rendererKindLabel(state.kind);
  const webgl2Available = isWebgl2Available();

  if (state.loadPromise && state.desiredKind === 'webgl') {
    return {
      activeKind: state.kind,
      desiredKind: state.desiredKind,
      label,
      health: 'loading',
      summary: 'Checking GPU renderer…',
      detail: 'WebGL is loading for the active terminal.',
      webgl2Available,
    };
  }

  if (state.kind === 'webgl') {
    return {
      activeKind: state.kind,
      desiredKind: state.desiredKind,
      label,
      health: 'gpu-active',
      summary: 'GPU acceleration is active',
      detail: webgl2Available
        ? 'The active terminal is rendering with WebGL.'
        : 'WebGL2 probe failed, but a WebGL renderer is active.',
      webgl2Available,
    };
  }

  if (!context.gpuAcceleration) {
    return {
      activeKind: state.kind,
      desiredKind: state.desiredKind,
      label,
      health: 'dom-expected',
      summary: 'DOM renderer (GPU off)',
      detail: 'Enable GPU acceleration above to use WebGL.',
      webgl2Available,
    };
  }

  const detail = describeFallbackReason(state, context);
  return {
    activeKind: state.kind,
    desiredKind: state.desiredKind,
    label,
    health: 'dom-fallback',
    summary: 'DOM fallback (GPU not active)',
    detail,
    webgl2Available,
  };
}

export function getTerminalRendererDiagnostics(
  sessionId: string | null | undefined,
  context: TerminalRendererDiagnosticsContext,
): TerminalRendererDiagnostics | null {
  if (!sessionId || !hasTerminalRendererSession(sessionId)) {
    return null;
  }
  return describeTerminalRendererState(getTerminalRendererState(sessionId), context);
}