const MAX_COMMAND_LEN = 500;
const MAX_SCAN_LINES = 80;

const OUTPUT_LINE = /^(?:On branch\b|nothing to commit|Your branch\b|Changes\b|Untracked files|modified:|new file:|deleted:|drwx|[-l]rwx|\d{4}-\d{2}-\d{2})/i;

const PROMPT_MARKERS = ['$ ', '# ', '> ', '% '] as const;

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function isValidPromptMarker(line: string, marker: string, idx: number): boolean {
  if (marker === '> ') {
    const prev = idx > 0 ? line[idx - 1] : '';
    if (prev === '>' || /\d/.test(prev)) return false;
  }
  return true;
}

function rightmostPromptMarkerIndex(line: string, marker: string): number {
  let searchEnd = line.length;
  while (searchEnd > 0) {
    const idx = line.lastIndexOf(marker, searchEnd - 1);
    if (idx < 0) return -1;
    if (isValidPromptMarker(line, marker, idx)) return idx;
    searchEnd = idx;
  }
  return -1;
}

function extractCommandFromLine(line: string): string {
  let trimmed = stripAnsi(line).trim();
  if (!trimmed) return '';

  let bestIdx = -1;
  let bestMarkerLen = 0;
  for (const marker of PROMPT_MARKERS) {
    const idx = rightmostPromptMarkerIndex(trimmed, marker);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestMarkerLen = marker.length;
    }
  }
  if (bestIdx >= 0) {
    trimmed = trimmed.slice(bestIdx + bestMarkerLen).trim();
  }

  return trimmed.replace(/(?:\x1b\[[0-9;]*m)*[\]$#%>]\s*$/, '').trim();
}

function looksLikeShellCommand(line: string): boolean {
  if (!line || line.length > MAX_COMMAND_LEN) return false;
  if (OUTPUT_LINE.test(line)) return false;
  const first = line[0];
  if (!/[A-Za-z0-9_~./$"'-]/.test(first)) return false;
  return true;
}

/**
 * Extract recent command-like lines from terminal scrollback for P6 ranking.
 * Heuristic only — prompts and noisy output are filtered out.
 */
export function extractRecentCommands(scrollback: string | null | undefined, limit = 12): string[] {
  if (!scrollback) return [];
  const lines = scrollback.split(/\r?\n/);
  const scanStart = Math.max(0, lines.length - Math.max(MAX_SCAN_LINES, limit * 6));
  const commands: string[] = [];
  for (let i = lines.length - 1; i >= scanStart && commands.length < limit; i--) {
    const candidate = extractCommandFromLine(lines[i] ?? '');
    if (!looksLikeShellCommand(candidate)) continue;
    if (commands[0] === candidate) continue;
    commands.unshift(candidate);
  }
  return commands;
}