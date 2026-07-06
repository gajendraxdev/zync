import { lineForSuggestionParsing } from './activeSegment.js';
import {
  FILE_AWARE_COMMANDS,
  getCommandName,
  getLastArg,
  hasPathSeparator,
} from './commandTokens.js';

const DIRECTORY_ONLY_COMMANDS = new Set(['cd', 'pushd', 'popd']);

function isPathTakingCommand(command: string): boolean {
  return DIRECTORY_ONLY_COMMANDS.has(command) || FILE_AWARE_COMMANDS.has(command);
}

function shouldGlueSuffix(line: string, suffix: string): boolean {
  const parseLine = lineForSuggestionParsing(line).trimEnd();
  const command = getCommandName(parseLine);
  const tokenCount = parseLine.split(/\s+/).filter(Boolean).length;

  if (tokenCount >= 2) {
    if (/^[ \t]/.test(suffix)) {
      const last = getLastArg(parseLine);
      if (hasPathSeparator(last) || last.startsWith('.')) {
        return true;
      }
      return false;
    }
    return true;
  }

  if (isPathTakingCommand(command)) return false;

  const suffixTrimmed = suffix.trimStart();
  if (/\s/.test(suffixTrimmed)) return false;

  return true;
}

function suffixGluesAsPathFragment(line: string, suffix: string): boolean {
  const trimmed = suffix.trimStart();
  if (!/^[/\\~.]/.test(trimmed)) return false;
  const tokenCount = lineForSuggestionParsing(line).trimEnd().split(/\s+/).filter(Boolean).length;
  return tokenCount >= 2;
}

/**
 * Normalize ghost suffix spacing against the full typed line.
 * Mirrors Rust `ghost::suffix` (runtime uses Rust; kept for unit tests).
 */
export function normalizeSuggestionSuffix(line: string, suffix: string): string {
  if (!suffix) return suffix;

  const endsWithSpace = /[ \t]$/.test(line);
  if (endsWithSpace) {
    return suffix.replace(/^[ \t]+/, '');
  }

  if (shouldGlueSuffix(line, suffix)) {
    return suffix.replace(/^[ \t]+/, '');
  }

  const startsWithSpace = /^[ \t]/.test(suffix);
  if (startsWithSpace) return suffix;

  if (suffixGluesAsPathFragment(line, suffix)) return suffix;

  return ` ${suffix}`;
}