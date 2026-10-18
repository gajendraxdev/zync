import { ghostDebug } from './ghostDebug.js';
import { clearPromptCwdSniffer, feedPromptCwdSniffer, stripAnsi } from './promptCwdSniffer.js';
import type { InputTracker } from './inputTracker.js';

const MAX_BUFFER_CHARS = 4096;

/** Prompts that expect hidden user input (sudo, SSH password, passphrases). */
const SECRET_PROMPT_PATTERNS = [
  /\[sudo\]\s+password\s+for\b/i,
  /\[sudo\]\s+password\b/i,
  /'s password:\s*$/i,
  /(?:^|\n)[^\n]{0,120}\bpassword\s*(?:for\b[^:\n]*)?:\s*$/i,
  /(?:^|\n)[^\n]{0,120}\bpassphrase\s*:\s*$/i,
  /\benter\s+passphrase\b/i,
  /\bpassphrase\s+for\b/i,
  /(?:^|\n)[^\n]{0,80}\bPIN\s*:\s*$/i,
] as const;

const sniffBuffers = new Map<string, string>();
const sniffDecoders = new Map<string, TextDecoder>();

function lastNonEmptyLine(text: string): string {
  const lines = stripAnsi(text).split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = (lines[i] ?? '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

export function detectSecretPromptInOutput(text: string): boolean {
  const lastLine = lastNonEmptyLine(text);
  // su / login / passwd style: lone "Password:" line
  if (/^password\s*:?\s*$/i.test(lastLine)) {
    return true;
  }

  const tail = stripAnsi(text).slice(-512);
  return SECRET_PROMPT_PATTERNS.some((pattern) => pattern.test(tail));
}

export type SnifferFeedOptions = { resetDecoder?: boolean; resetBuffer?: boolean };

/** Feed PTY output; invokes onSecretPrompt when a hidden-input prompt is recognized. */
export function feedSecretInputSniffer(
  termId: string,
  data: Uint8Array,
  onSecretPrompt: () => void,
  options?: SnifferFeedOptions,
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

  if (!detectSecretPromptInOutput(merged)) return;

  ghostDebug('secret-input', { termId, phase: 'prompt-detected' });
  onSecretPrompt();
  // Drop matched prompt text so later PTY chunks cannot re-enter secret-input mode.
  sniffBuffers.set(termId, '');
}

export function clearSecretInputSniffer(termId: string): void {
  sniffBuffers.delete(termId);
  sniffDecoders.delete(termId);
}

/** Keep password detection and fresh shell-prompt recovery in one ordered path. */
export function feedTerminalPromptSniffers(
  termId: string,
  data: Uint8Array,
  tracker: Pick<InputTracker, 'enterSecretInputMode' | 'exitSecretInputMode'> | undefined,
  onCwd: (path: string) => void,
  options?: SnifferFeedOptions & { allowPromptRecovery?: boolean },
): void {
  feedSecretInputSniffer(termId, data, () => {
    clearPromptCwdSniffer(termId);
    tracker?.enterSecretInputMode();
  }, options);
  // A queued password prompt is still positive evidence of hidden input even
  // after another command was sent. Its older shell prompt must not unlock it.
  if (options?.allowPromptRecovery === false) return;
  feedPromptCwdSniffer(termId, data, (path) => {
    clearSecretInputSniffer(termId);
    tracker?.exitSecretInputMode();
    onCwd(path);
  }, options);
}
