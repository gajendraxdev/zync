import { lineForSuggestionParsing } from './activeSegment.js';

const DIRECTORY_ONLY_COMMANDS = new Set(['cd', 'pushd', 'popd']);

export const FILE_AWARE_COMMANDS = new Set([
  'cat',
  'ls',
  'less',
  'more',
  'head',
  'tail',
  'grep',
  'vim',
  'nvim',
  'nano',
  'cp',
  'mv',
  'rm',
  'mkdir',
  'rmdir',
  'touch',
  'find',
  'stat',
  'chmod',
  'chown',
]);

const WRAPPER_COMMANDS = new Set(['sudo', 'env', 'time', 'nohup', 'command']);
const FLAGS_WITH_ARG = new Set([
  '-u', '--user', '-g', '--group', '-o', '-p', '-t', '-c', '-s', '-f', '-k', '-m', '-n', '-d',
]);

function shellTokenize(line: string): string[] {
  const tokens: string[] = [];
  let token = '';
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) { token += ch; escaped = false; continue; }
    if (ch === '\\' && !inSingle) { escaped = true; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) {
      if (token) { tokens.push(token); token = ''; }
      continue;
    }
    token += ch;
  }
  if (token) tokens.push(token);
  return tokens;
}

export function getLastArg(line: string): string {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let start = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (ch === ' ' && !inSingle && !inDouble) start = i + 1;
  }

  return line.slice(start);
}

export function stripLeadingUnmatchedQuote(arg: string): string {
  if (arg.length > 0 && (arg[0] === '"' || arg[0] === "'")) {
    const q = arg[0];
    if (!arg.slice(1).includes(q)) return arg.slice(1);
  }
  return arg;
}

export function getCommandName(line: string): string {
  const trimmed = line.trimStart();
  if (!trimmed) return '';
  const parts = shellTokenize(trimmed);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].toLowerCase();
    if (WRAPPER_COMMANDS.has(part)) {
      while (i + 1 < parts.length) {
        const next = parts[i + 1];
        if (FLAGS_WITH_ARG.has(next.toLowerCase())) { i += 2; continue; }
        if (next.startsWith('-')) { i++; continue; }
        if (part === 'env' && /^[A-Za-z_][A-Za-z0-9_]*=/.test(next)) { i++; continue; }
        break;
      }
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[i])) continue;
    return part;
  }
  return '';
}

export function hasPathSeparator(arg: string): boolean {
  return arg.includes('/') || arg.includes('\\');
}

export function expandTildePathForRemote(path: string, home: string): string {
  const trimmed = path.trim();
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const rest = trimmed.slice(2).replace(/\\/g, '/').replace(/^\/+/, '');
    return rest ? `${home}/${rest}` : home;
  }
  return path;
}

export function hasUnmatchedQuoteOnActiveToken(line: string): boolean {
  const arg = getLastArg(lineForSuggestionParsing(line));
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < arg.length; i++) {
    const ch = arg[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
  }

  return inSingle || inDouble;
}

export function isBareDirectoryListingLine(line: string): boolean {
  const trimmed = lineForSuggestionParsing(line).trimEnd();
  const command = getCommandName(trimmed);
  if (!DIRECTORY_ONLY_COMMANDS.has(command)) return false;
  const lastArg = getLastArg(trimmed);
  return !lastArg || lastArg.toLowerCase() === command;
}

export function shouldPreferPathSuggestion(line: string): boolean {
  const parseLine = lineForSuggestionParsing(line);
  const command = getCommandName(parseLine);
  if (DIRECTORY_ONLY_COMMANDS.has(command) || FILE_AWARE_COMMANDS.has(command)) {
    return true;
  }
  const lastArg = getLastArg(parseLine);
  return hasPathSeparator(lastArg);
}