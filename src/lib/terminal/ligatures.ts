import type { Terminal } from '@xterm/xterm';
import { terminalCache } from './terminalCache.js';

let ligaturesAddonImport: Promise<typeof import('@xterm/addon-ligatures')> | null = null;

export async function setTerminalLigatures(
  sessionId: string,
  term: Terminal,
  enabled: boolean,
): Promise<void> {
  const cached = terminalCache.get(sessionId);
  if (!cached) return;
  cached.ligaturesDesiredEnabled = enabled;

  if (enabled) {
    if (cached.ligaturesAddon) {
      cached.ligaturesEnabled = true;
      return;
    }
    if (!cached.ligaturesLoadPromise) {
      cached.ligaturesLoadPromise = (async () => {
        try {
          if (!ligaturesAddonImport) {
            ligaturesAddonImport = import('@xterm/addon-ligatures');
          }
          const { LigaturesAddon } = await ligaturesAddonImport;
          const latest = terminalCache.get(sessionId);
          if (!latest || latest.ligaturesDesiredEnabled !== true || latest.ligaturesAddon) return;
          const addon = new LigaturesAddon();
          term.loadAddon(addon);
          latest.ligaturesAddon = addon;
        } catch (error) {
          console.warn('[terminal] Failed to load ligatures addon', error);
        } finally {
          const latest = terminalCache.get(sessionId);
          if (latest) latest.ligaturesLoadPromise = null;
        }
      })();
    }
    await cached.ligaturesLoadPromise;
    const latest = terminalCache.get(sessionId);
    cached.ligaturesEnabled = Boolean(latest && latest.ligaturesAddon);
    return;
  }

  disposeTerminalLigatures(cached);
  cached.ligaturesEnabled = false;
}

export function disposeTerminalLigatures(cached: { ligaturesAddon?: { dispose: () => void }; ligaturesEnabled?: boolean }): void {
  if (cached.ligaturesAddon) {
    try {
      cached.ligaturesAddon.dispose();
    } catch (error) {
      console.warn('[terminal] Failed to dispose ligatures addon', error);
    }
    cached.ligaturesAddon = undefined;
  }
  if ('ligaturesEnabled' in cached) {
    cached.ligaturesEnabled = false;
  }
}