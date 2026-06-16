import type { TerminalRendererKind } from './types.js';

export interface TerminalRendererPreferences {
  gpuAcceleration: boolean;
}

export interface TerminalRendererPolicyContext extends TerminalRendererPreferences {
  webglContextLossBlocked?: boolean;
}

/**
 * Resolves which xterm renderer should be active.
 * Ligatures are applied separately via LigaturesAddon; when both are enabled, WebGL is
 * reactivated after ligatures so font-feature-settings reach the texture atlas.
 */
export function resolveDesiredTerminalRenderer(
  context: TerminalRendererPolicyContext,
): TerminalRendererKind {
  if (!context.gpuAcceleration) return 'canvas';
  if (context.webglContextLossBlocked) return 'canvas';
  return 'webgl';
}

export function rendererKindLabel(kind: TerminalRendererKind): string {
  return kind === 'webgl' ? 'GPU (WebGL)' : 'Canvas';
}