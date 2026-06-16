import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppStore } from '../../../store/useAppStore';
import {
  getTerminalRendererDiagnostics,
  type TerminalRendererDiagnostics,
  type TerminalRendererHealth,
} from '../../../lib/terminal';

interface TerminalRendererStatusProps {
  gpuAcceleration: boolean;
}

function useActiveTerminalSessionId(): string | null {
  const activeTabId = useAppStore((state) => state.activeTabId);
  const tabs = useAppStore((state) => state.tabs);
  const activeTerminalIds = useAppStore((state) => state.activeTerminalIds);

  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab?.connectionId || activeTab.view !== 'terminal') {
    return null;
  }
  return activeTerminalIds[activeTab.connectionId] ?? null;
}

function healthStyles(health: TerminalRendererHealth): { dot: string; text: string } {
  switch (health) {
    case 'gpu-active':
      return {
        dot: 'bg-emerald-400',
        text: 'text-emerald-300',
      };
    case 'canvas-fallback':
      return {
        dot: 'bg-amber-400',
        text: 'text-amber-300',
      };
    case 'loading':
      return {
        dot: 'bg-sky-400 animate-pulse',
        text: 'text-sky-300',
      };
    default:
      return {
        dot: 'bg-[var(--color-app-muted)]',
        text: 'text-[var(--color-app-muted)]',
      };
  }
}

export function TerminalRendererStatus({ gpuAcceleration }: TerminalRendererStatusProps) {
  const sessionId = useActiveTerminalSessionId();
  const [diagnostics, setDiagnostics] = useState<TerminalRendererDiagnostics | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setDiagnostics(getTerminalRendererDiagnostics(sessionId, { gpuAcceleration }));
  }, [gpuAcceleration, sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh, refreshToken]);

  useEffect(() => {
    const handleRendererChanged = () => {
      refresh();
    };
    window.addEventListener('zync:terminal-renderer-changed', handleRendererChanged);
    return () => {
      window.removeEventListener('zync:terminal-renderer-changed', handleRendererChanged);
    };
  }, [refresh]);

  const styles = diagnostics ? healthStyles(diagnostics.health) : null;

  return (
    <div className="rounded-xl border border-[var(--color-app-border)]/60 bg-[var(--color-app-surface)]/30 px-3 py-2.5 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium text-[var(--color-app-text)]">Renderer status</p>
        <button
          type="button"
          onClick={() => setRefreshToken((value) => value + 1)}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] border border-[var(--color-app-border)] hover:bg-[var(--color-app-surface)] text-[var(--color-app-muted)]"
        >
          <RefreshCw className="w-3 h-3" />
          Refresh
        </button>
      </div>

      {!sessionId || !diagnostics ? (
        <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
          Open a visible terminal tab, then refresh to verify whether GPU acceleration is active.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <span className={`inline-block w-2 h-2 rounded-full ${styles?.dot}`} />
            <p className={`text-xs font-semibold ${styles?.text}`}>{diagnostics.summary}</p>
            <span className="text-[11px] text-[var(--color-app-muted)]">({diagnostics.label})</span>
          </div>
          {diagnostics.detail ? (
            <p className="text-[11px] leading-relaxed text-[var(--color-app-muted)]">
              {diagnostics.detail}
            </p>
          ) : null}
          <p className="text-[11px] text-[var(--color-app-muted)]">
            WebGL2 available: {diagnostics.webgl2Available ? 'Yes' : 'No'}
          </p>
        </>
      )}
    </div>
  );
}