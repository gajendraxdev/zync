import { ghostDebug } from './ghostDebug.js';

/**
 * Passive cwd extraction from shell prompt text in PTY output.
 * PowerShell does not emit OSC 7 by default; this keeps ghost path completion aligned.
 */

const MAX_BUFFER_CHARS = 4096;

/** Strip CSI/OSC ANSI sequences from prompt fragments. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '');
}

function normalizePromptPath(raw: string): string {
  let path = raw.trim().replace(/^['"]|['"]$/g, '');
  if (!path || path === '~') return '~';
  // PowerShell may render forward slashes in some themes.
  if (/^[A-Za-z]:/.test(path)) {
    return path.replace(/\//g, '\\');
  }
  return path;
}

/** Only the current output line can be a prompt awaiting input. */
function currentPromptLine(text: string): string {
  const clean = stripAnsi(text);
  return clean.slice(Math.max(clean.lastIndexOf('\r'), clean.lastIndexOf('\n')) + 1);
}

/**
 * Extract cwd from the latest PowerShell prompt (`PS E:\work>` / `PS E:\work›`).
 */
const POWERSHELL_PROMPT_PATH =
  /(?:[A-Za-z]:[\\/]|\\\\|~[/\\]?|\/)[^\r\n\x1b›>\u203a]*/;

export function extractPowerShellCwd(text: string): string | null {
  const clean = currentPromptLine(text);
  const re = new RegExp(
    `^(?:\\([^\\r\\n)]*\\)\\s+)?PS\\s+(${POWERSHELL_PROMPT_PATH.source})\\s*[›>\\u203a]\\s*$`,
  );
  const match = re.exec(clean);
  return match ? normalizePromptPath(match[1] ?? '') : null;
}

/** CMD's default prompt reports an absolute drive or UNC directory. */
export function extractCmdCwd(text: string): string | null {
  const match = /^((?:[A-Za-z]:[\\/]|\\\\)[^\r\n>]+|[A-Za-z]:[\\/])>\s*$/.exec(currentPromptLine(text));
  return match ? normalizePromptPath(match[1]) : null;
}

/**
 * Extract cwd from common Unix prompts (`user@host:~/path$`, `host:~ $`, `/path#`, etc.).
 */
export function extractUnixPromptCwd(text: string): string | null {
  const clean = currentPromptLine(text);
  const patterns = [
    // user@host:~/path$ or bare /path#
    /^(?:[^\r\n@]*@[^\r\n:]*:)?([/~][^\r\n$#%›>]*)[$#%›>]\s*$/,
    // host:~/path$ / host:~ $ (no @ — common in WSL zsh themes)
    /^(?:[^\r\n$#%›>\s]+):([/~][^\r\n$#%›>]*)\s*[$#%›>]\s*$/,
  ];
  for (const re of patterns) {
    const match = re.exec(clean);
    if (match) return normalizePromptPath(match[1] ?? '');
  }
  return null;
}

export function extractCwdFromPromptOutput(text: string): string | null {
  return extractPowerShellCwd(text) ?? extractCmdCwd(text) ?? extractUnixPromptCwd(text);
}

const sniffBuffers = new Map<string, string>();
const sniffDecoders = new Map<string, TextDecoder>();

export type CwdSnifferFeedOptions = { resetDecoder?: boolean; resetBuffer?: boolean };

/** Feed PTY output bytes; invokes onCwd when a prompt path is recognized. */
export function feedPromptCwdSniffer(
  termId: string,
  data: Uint8Array,
  onCwd: (path: string) => void,
  options?: CwdSnifferFeedOptions,
): void {
  if (!data.length) return;

  let decoder = sniffDecoders.get(termId);
  if (options?.resetDecoder || !decoder) {
    decoder = new TextDecoder('utf-8', { fatal: false });
    sniffDecoders.set(termId, decoder);
  }
  if (options?.resetBuffer) {
    sniffBuffers.delete(termId);
  }

  const chunk = decoder.decode(data, { stream: true });
  const prev = sniffBuffers.get(termId) ?? '';
  const merged = (prev + chunk).slice(-MAX_BUFFER_CHARS);
  sniffBuffers.set(termId, merged);

  const cwd = extractCwdFromPromptOutput(merged);
  if (cwd) {
    // Consume a matched prompt. Rechecking it on later echo/password output
    // would reset live input and could incorrectly leave secret-input mode.
    sniffBuffers.delete(termId);
    ghostDebug('cwd-sniff', { termId, cwd });
    onCwd(cwd);
  }
}

export function clearPromptCwdSniffer(termId: string): void {
  sniffBuffers.delete(termId);
  sniffDecoders.delete(termId);
}
