import { useEffect, useMemo, type RefObject } from 'react';
import type { Terminal as XTerm } from '@xterm/xterm';
import type { Connection } from '../../store/useAppStore';
import {
  buildTerminalHostStyle,
  resolveTerminalTransparency,
  resolveXtermTheme,
  type TerminalTransparencySettings,
} from './terminalTheme.js';

export interface TerminalSettingsSlice {
  fontSize: number;
  fontFamily: string;
  cursorStyle: 'block' | 'underline' | 'bar';
  lineHeight: number;
}

export interface UseTerminalThemeOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  termRef: RefObject<XTerm | null>;
  settings: TerminalTransparencySettings & {
    theme: string;
    accentColor?: string | null;
    terminal: TerminalSettingsSlice;
  };
  connection: Connection | null | undefined;
  activeConnectionId: string | null | undefined;
  sessionId: string;
  isConnected: boolean;
}

export function useTerminalTheme({
  containerRef,
  termRef,
  settings,
  connection,
  activeConnectionId,
  sessionId,
  isConnected,
}: UseTerminalThemeOptions) {
  const terminalTransparency = useMemo(
    () => resolveTerminalTransparency(settings),
    [settings.enableVibrancy, settings.windowOpacity],
  );

  const terminalHostStyle = useMemo(
    () => buildTerminalHostStyle(terminalTransparency),
    [terminalTransparency],
  );

  const resolveInitialTheme = () => resolveXtermTheme(
    containerRef.current,
    connection?.theme,
    terminalTransparency,
  );

  useEffect(() => {
    if (!isConnected || !termRef.current) {
      return;
    }

    const term = termRef.current;
    term.options.fontSize = settings.terminal.fontSize;
    term.options.fontFamily = settings.terminal.fontFamily;
    term.options.cursorStyle = settings.terminal.cursorStyle;
    term.options.lineHeight = settings.terminal.lineHeight;
  }, [sessionId, settings.terminal, isConnected, termRef]);

  useEffect(() => {
    if (!termRef.current || !activeConnectionId) {
      return;
    }

    termRef.current.options.theme = resolveXtermTheme(
      containerRef.current,
      connection?.theme,
      terminalTransparency,
    );
  }, [
    sessionId,
    settings.theme,
    settings.accentColor,
    settings.enableVibrancy,
    settings.windowOpacity,
    connection?.theme,
    activeConnectionId,
    terminalTransparency,
    containerRef,
    termRef,
  ]);

  return {
    terminalTransparency,
    terminalHostStyle,
    resolveInitialTheme,
  };
}