export type {
  TerminalRendererKind,
  TerminalRendererState,
} from './types.js';
export { createInitialRendererState } from './types.js';

export type {
  TerminalRendererPolicyContext,
  TerminalRendererPreferences,
} from './rendererPolicy.js';
export {
  resolveDesiredTerminalRenderer,
  rendererKindLabel,
} from './rendererPolicy.js';

export {
  isWebgl2Available,
  resetWebgl2AvailabilityCache,
} from './webglCapability.js';

export {
  clearTerminalRendererSession,
  ensureCanvasRendererForSession,
  getTerminalRendererState,
  hasTerminalRendererSession,
} from './rendererSession.js';

export type { SyncTerminalRendererOptions } from './rendererController.js';
export { reactivateTerminalWebgl, syncTerminalRenderer } from './rendererController.js';

export type {
  TerminalRendererDiagnostics,
  TerminalRendererDiagnosticsContext,
  TerminalRendererHealth,
} from './rendererDiagnostics.js';
export {
  describeTerminalRendererState,
  getTerminalRendererDiagnostics,
} from './rendererDiagnostics.js';
export {
  activateCanvasRenderer,
  disposeTerminalRenderer,
  ensureCanvasRenderer,
  refreshTerminalScreen,
} from './rendererLifecycle.js';