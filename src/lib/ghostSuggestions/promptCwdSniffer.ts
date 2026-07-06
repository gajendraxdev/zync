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

/**
 * Extract cwd from the latest PowerShell prompt (`PS E:\work>` / `PS E:\work›`).
 */
export function extractPowerShellCwd(text: string): string | null {
  const clean = stripAnsi(text);
  const re = /PS\s+((?:[A-Za-z]:)?[^\r\n\x1b›>\u203a]+?)\s*[›>\u203a]/g;
  let last: string | null = null;
  for (const match of clean.matchAll(re)) {
    const candidate = normalizePromptPath(match[1] ?? '');
    if (candidate) last = candidate;
  }
  return last;
}

/**
 * Extract cwd from common Unix prompts (`user@host:~/path$`, `host:~ $`, `/path#`, etc.).
 */
export function extractUnixPromptCwd(text: string): string | null {
  const clean = stripAnsi(text);
  const patterns = [
    // user@host:~/path$ or bare /path#
    /(?:^|\n)(?:[^\r\n@]*@[^\r\n:]*:)?([/~][^\r\n$#%›>]+)[$#%›>]\s*(?:\r?\n|$)/g,
    // host:~/path$ / host:~ $ (no @ — common in WSL zsh themes)
    /(?:^|\n)(?:[^\r\n$#%›>\s]+):([/~][^\r\n$#%›>]*)\s*[$#%›>]/g,
  ];
  let last: string | null = null;
  for (const re of patterns) {
    for (const match of clean.matchAll(re)) {
      const candidate = normalizePromptPath(match[1] ?? '');
      if (candidate) last = candidate;
    }
  }
  return last;
}

export function extractCwdFromPromptOutput(text: string): string | null {
  return extractPowerShellCwd(text) ?? extractUnixPromptCwd(text);
}

const sniffBuffers = new Map<string, string>();
const sniffDecoders = new Map<string, TextDecoder>();

/** Feed PTY output bytes; invokes onCwd when a prompt path is recognized. */
export function feedPromptCwdSniffer(
  termId: string,
  data: Uint8Array,
  onCwd: (path: string) => void,
): void {
  if (!data.length) return;

  let decoder = sniffDecoders.get(termId);
  if (!decoder) {
    decoder = new TextDecoder('utf-8', { fatal: false });
    sniffDecoders.set(termId, decoder);
  }

  const chunk = decoder.decode(data, { stream: true });
  const prev = sniffBuffers.get(termId) ?? '';
  const merged = (prev + chunk).slice(-MAX_BUFFER_CHARS);
  sniffBuffers.set(termId, merged);

  const cwd = extractCwdFromPromptOutput(merged);
  if (cwd) {
    onCwd(cwd);
  }
}

export function clearPromptCwdSniffer(termId: string): void {
  sniffBuffers.delete(termId);
  sniffDecoders.delete(termId);
}