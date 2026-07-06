import {
  getCommandName,
  getLastArg,
  inferSeparator,
  resolveDir,
  stripLeadingUnmatchedQuote,
  stripTrailingSep,
} from './pathCompletion.js';

function isAbsolutePath(arg: string): boolean {
  return (
    arg.startsWith('/') ||
    arg.startsWith('~') ||
    /^[A-Za-z]:[/\\]/.test(arg) ||
    arg.startsWith('\\\\')
  );
}

/**
 * Best-effort cwd update after `cd` / `pushd` commits when OSC 7 is unavailable.
 */
export function resolveCdTargetPath(line: string, cwd?: string): string | null {
  const trimmed = line.trim();
  const command = getCommandName(trimmed);
  if (command !== 'cd' && command !== 'pushd') return null;

  const arg = stripLeadingUnmatchedQuote(getLastArg(trimmed));
  if (!arg || arg.toLowerCase() === command) return null;
  if (arg.startsWith('-')) return null;

  if (arg === '~') return '~';
  if (arg.startsWith('~/') || arg.startsWith('~\\')) return arg;

  if (arg === '..') {
    return parentDirectory(cwd);
  }

  if (isAbsolutePath(arg)) {
    return stripTrailingSep(arg);
  }

  if (!cwd) return arg;
  return stripTrailingSep(resolveDir(arg, cwd, inferSeparator(cwd)));
}

function parentDirectory(cwd?: string): string | null {
  if (!cwd) return null;

  if (cwd === '~') return null;

  if (cwd.startsWith('~/') || cwd.startsWith('~\\')) {
    const rest = cwd.slice(2);
    const parts = rest.split(/[/\\]/).filter(Boolean);
    parts.pop();
    return parts.length ? `~/${parts.join('/')}` : '~';
  }

  const sep = inferSeparator(cwd);
  const trimmed = stripTrailingSep(cwd);
  const driveMatch = /^([A-Za-z]:)(?:\\|\/)(.*)$/.exec(trimmed);
  if (driveMatch) {
    const rest = driveMatch[2];
    if (!rest) return `${driveMatch[1]}\\`;
    const parts = rest.split(/[/\\]/).filter(Boolean);
    parts.pop();
    return parts.length ? `${driveMatch[1]}\\${parts.join('\\')}` : `${driveMatch[1]}\\`;
  }
  if (trimmed === '/') return '/';
  const parts = trimmed.split(/[/\\]/).filter(Boolean);
  parts.pop();
  return parts.length ? `${sep}${parts.join(sep)}` : sep;
}