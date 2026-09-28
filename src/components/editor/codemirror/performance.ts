export interface CodeMirrorPerformanceLimits {
  maxCharactersForRichEditing: number;
  maxLinesForRichEditing: number;
}

export const DEFAULT_CODEMIRROR_PERFORMANCE_LIMITS: CodeMirrorPerformanceLimits = {
  maxCharactersForRichEditing: 2 * 1024 * 1024,
  maxLinesForRichEditing: 50_000,
};

export interface CodeMirrorPerformanceMode {
  kind: 'full' | 'large-file';
  characters: number;
  lines: number;
  reason: 'character-limit' | 'line-limit' | null;
}

function countLines(content: string) {
  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) lines += 1;
  }
  return lines;
}

export function resolveCodeMirrorPerformanceMode(
  content: string,
  limits: CodeMirrorPerformanceLimits = DEFAULT_CODEMIRROR_PERFORMANCE_LIMITS,
): CodeMirrorPerformanceMode {
  const characters = content.length;
  const lines = countLines(content);

  if (characters > limits.maxCharactersForRichEditing) {
    return { kind: 'large-file', characters, lines, reason: 'character-limit' };
  }

  if (lines > limits.maxLinesForRichEditing) {
    return { kind: 'large-file', characters, lines, reason: 'line-limit' };
  }

  return { kind: 'full', characters, lines, reason: null };
}
