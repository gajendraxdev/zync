import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { reactivateTerminalWebgl, syncTerminalRenderer } from './rendererController.js';
import { setTerminalLigatures } from './ligatures.js';
import { getTerminalRendererState } from './rendererSession.js';
import { isTerminalFitReady, safeFitTerminal } from './terminalFit.js';
import { applyTerminalTypography, buildWebglTypographyStamp } from './terminalTypography.js';
import { useAppStore } from '../../store/useAppStore.js';
import type { TerminalRendererState } from './types.js';

/**
 * True when renderer policy does not match session state (e.g. fresh `dom` default
 * while GPU is on, or WebGL still loaded after GPU was turned off).
 */
export function needsTerminalRendererSetup(
  state: TerminalRendererState,
  gpuDesired: boolean,
): boolean {
  const webglActive = state.kind === 'webgl' && Boolean(state.webglAddon);
  if (state.webglContextLossBlocked) {
    return false;
  }
  if (gpuDesired) {
    return !webglActive;
  }
  return webglActive;
}

function buildWebglLigaturesStamp(fontLigatures: boolean, fontFamily: string | undefined): string {
  return `${fontLigatures}:${fontFamily ?? ''}`;
}

export interface TerminalRendererSetupSettings {
  gpuAcceleration?: boolean;
  fontLigatures?: boolean;
}

export type TerminalResizeSync = (sessionId: string, term: Terminal) => void;

export function getTerminalRendererPreferences(
  terminalSettings: TerminalRendererSetupSettings,
) {
  return {
    gpuAcceleration: terminalSettings.gpuAcceleration ?? true,
    fontLigatures: Boolean(terminalSettings.fontLigatures),
  };
}

/** Only the visible active shell tab should hold a WebGL context. */
export function buildEffectiveRendererSettings(
  terminalSettings: TerminalRendererSetupSettings,
  gpuAllowed: boolean,
): TerminalRendererSetupSettings {
  const prefs = getTerminalRendererPreferences(terminalSettings);
  return {
    ...terminalSettings,
    gpuAcceleration: prefs.gpuAcceleration && gpuAllowed,
  };
}

export function buildRendererRefitCallback(
  sessionId: string,
  fitAddon: FitAddon | null,
  term: Terminal | null,
  syncResize: TerminalResizeSync,
) {
  return () => {
    try {
      if (!term || !isTerminalFitReady(term, fitAddon)) {
        return;
      }
      if (!safeFitTerminal(fitAddon, term)) {
        return;
      }
      const lastRow = Math.max(0, term.rows - 1);
      term.refresh(0, lastRow);
      syncResize(sessionId, term);
    } catch (error) {
      console.warn('[terminal] Renderer refit failed', error);
    }
  };
}

export async function applyTerminalRendererAndLigatures(
  sessionId: string,
  term: Terminal,
  terminalSettings: TerminalRendererSetupSettings,
  fitAddon: FitAddon | null,
  syncResize: TerminalResizeSync,
): Promise<void> {
  try {
    const prefs = getTerminalRendererPreferences(terminalSettings);
    const onRefit = buildRendererRefitCallback(sessionId, fitAddon, term, syncResize);
    const rendererState = getTerminalRendererState(sessionId);
    const ligaturesStamp = buildWebglLigaturesStamp(prefs.fontLigatures, term.options.fontFamily);
    const typographyStamp = buildWebglTypographyStamp(term, sessionId);
    const typographyChanged = rendererState.webglTypographyStamp !== typographyStamp;

    await syncTerminalRenderer(sessionId, term, {
      gpuAcceleration: prefs.gpuAcceleration,
      onRefit,
    });
    await setTerminalLigatures(sessionId, term, prefs.fontLigatures);

    if (prefs.gpuAcceleration && rendererState.kind === 'webgl' && rendererState.webglAddon && typographyChanged) {
      const webglAddon = rendererState.webglAddon as { clearTextureAtlas?: () => void };
      if (typeof webglAddon.clearTextureAtlas === 'function') {
        webglAddon.clearTextureAtlas();
        rendererState.webglTypographyStamp = typographyStamp;
        onRefit();
      } else {
        const kind = await reactivateTerminalWebgl(sessionId, term, { onRefit });
        if (kind === 'webgl') {
          rendererState.webglTypographyStamp = typographyStamp;
          onRefit();
        }
      }
    }

    if (prefs.gpuAcceleration && prefs.fontLigatures) {
      const webglReady = rendererState.kind === 'webgl' && Boolean(rendererState.webglAddon);
      const stampMatches = rendererState.webglLigaturesStamp === ligaturesStamp;
      if (webglReady && stampMatches) {
        // Visibility restore (Files→Terminal): keep WebGL alive; dispose here blanks the screen.
        onRefit();
      } else {
        const kind = await reactivateTerminalWebgl(sessionId, term, { onRefit });
        if (kind === 'webgl') {
          rendererState.webglLigaturesStamp = ligaturesStamp;
        }
      }
    } else {
      rendererState.webglLigaturesStamp = undefined;
    }

    if (!rendererState.webglTypographyStamp) {
      rendererState.webglTypographyStamp = typographyStamp;
    }

    const { terminal } = useAppStore.getState().settings;
    applyTerminalTypography(sessionId, term, terminal);

    try {
      const lastRow = Math.max(0, term.rows - 1);
      term.refresh(0, lastRow);
    } catch {
      // Ignore refresh failures; geometry already handled by syncTerminalRenderer / refit callback.
    }
  } catch (error) {
    console.warn('[terminal] Renderer setup failed', error);
  }
}