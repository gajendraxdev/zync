import { terminalCache } from '../terminal/terminalCache.js';
import { shellIdIndicatesZsh } from './shellSuppression.js';
import {
  parseWslDistro,
  shellIdIndicatesWsl,
} from './wslShell.js';

const ZSH_INIT_FILES = ['.zshrc', '.zprofile', '.zshenv'] as const;
const MAX_SCAN_CHARS = 128_000;

const AUTOSUGGEST_LINE_PATTERNS = [
  /zsh-autosuggestions/i,
  /plugins=\([^)]*\bautosuggestions\b/i,
  /zinit(?:\s+light|\s+snippet|\s+load).{0,120}autosuggestions/i,
  /antigen\s+bundle.{0,80}autosuggestions/i,
  /source\s+.{0,120}zsh-autosuggestions/i,
];

export { parseWslDistro, shellIdIndicatesWsl } from './wslShell.js';

/** True when a background zsh-autosuggestions probe should run for this shell id. */
export function shouldProbeZshAutosuggest(shellId?: string): boolean {
  if (!shellId) return false;
  return shellIdIndicatesZsh(shellId) || shellIdIndicatesWsl(shellId);
}

function joinUnixPath(base: string, segment: string): string {
  const trimmed = base.replace(/[/\\]+$/, '');
  return `${trimmed}/${segment}`;
}

/** Parse zsh init file text for zsh-autosuggestions (or equivalent) plugin hooks. */
export function zshInitEnablesAutosuggestions(content: string): boolean {
  const scan = content.slice(0, MAX_SCAN_CHARS);
  const lines = scan.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.replace(/^\s*#.*$/, '').trim();
    if (!line) continue;
    if (AUTOSUGGEST_LINE_PATTERNS.some((re) => re.test(line))) {
      return true;
    }
  }

  return false;
}

async function readZshInitFile(connectionId: string, path: string): Promise<string | null> {
  try {
    const content = await window.ipcRenderer.invoke('fs_read_file', {
      connectionId,
      path,
    });
    return typeof content === 'string' ? content : null;
  } catch {
    return null;
  }
}

async function probeHostZshAutosuggestions(connectionId: string): Promise<boolean> {
  try {
    const home = await window.ipcRenderer.invoke('fs_cwd', { connectionId }) as string;
    if (!home || typeof home !== 'string') return false;

    for (const file of ZSH_INIT_FILES) {
      const content = await readZshInitFile(connectionId, joinUnixPath(home, file));
      if (content && zshInitEnablesAutosuggestions(content)) {
        return true;
      }
    }
  } catch {
    return false;
  }

  return false;
}

async function probeWslZshAutosuggestions(shellId: string): Promise<boolean> {
  try {
    const content = await window.ipcRenderer.invoke('read_wsl_zsh_init_files', {
      wslDistro: parseWslDistro(shellId),
    });
    return typeof content === 'string'
      && content.length > 0
      && zshInitEnablesAutosuggestions(content);
  } catch {
    return false;
  }
}

/** Probe zsh init files once per terminal session (host FS or WSL Linux home). */
export async function probeZshAutosuggestions(
  connectionId: string,
  shellId?: string,
): Promise<boolean> {
  if (shellId && shellIdIndicatesWsl(shellId)) {
    return probeWslZshAutosuggestions(shellId);
  }
  return probeHostZshAutosuggestions(connectionId);
}

function clearZshAutosuggestProbeState(termId: string): void {
  const cached = terminalCache.get(termId);
  if (!cached) return;
  cached.zshAutosuggestEnabled = undefined;
  cached.zshAutosuggestProbe = undefined;
}

/**
 * Start a background probe when the active shell is zsh or a WSL session.
 * Result is stored on terminalCache for ghost suppression (P3).
 */
export function scheduleZshAutosuggestProbe(
  termId: string,
  connectionId: string,
  shellId?: string,
): void {
  const cached = terminalCache.get(termId);
  if (!cached) return;

  if (!shouldProbeZshAutosuggest(shellId)) {
    clearZshAutosuggestProbeState(termId);
    return;
  }

  if (cached.zshAutosuggestProbe) return;

  cached.zshAutosuggestEnabled = undefined;
  cached.zshAutosuggestProbe = probeZshAutosuggestions(connectionId, shellId)
    .then((enabled) => {
      const current = terminalCache.get(termId);
      if (current) current.zshAutosuggestEnabled = enabled;
      return enabled;
    })
    .finally(() => {
      const current = terminalCache.get(termId);
      if (current) current.zshAutosuggestProbe = undefined;
    });
}

export function getZshAutosuggestEnabled(termId: string): boolean | undefined {
  return terminalCache.get(termId)?.zshAutosuggestEnabled;
}