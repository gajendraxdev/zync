import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { reactivateTerminalWebgl, syncTerminalRenderer } from './rendererController.js';
import { setTerminalLigatures } from './ligatures.js';

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

export function buildRendererRefitCallback(
  sessionId: string,
  fitAddon: FitAddon | null,
  term: Terminal | null,
  syncResize: TerminalResizeSync,
) {
  return () => {
    try {
      fitAddon?.fit();
      if (term) {
        const lastRow = Math.max(0, term.rows - 1);
        term.refresh(0, lastRow);
        syncResize(sessionId, term);
      }
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
  const prefs = getTerminalRendererPreferences(terminalSettings);
  const onRefit = buildRendererRefitCallback(sessionId, fitAddon, term, syncResize);
  await syncTerminalRenderer(sessionId, term, {
    gpuAcceleration: prefs.gpuAcceleration,
    onRefit,
  });
  await setTerminalLigatures(sessionId, term, prefs.fontLigatures);
  if (prefs.gpuAcceleration && prefs.fontLigatures) {
    await reactivateTerminalWebgl(sessionId, term, { onRefit });
  }
  try {
    const lastRow = Math.max(0, term.rows - 1);
    term.refresh(0, lastRow);
  } catch {
    // Ignore refresh failures; fit below still applies geometry.
  }
}