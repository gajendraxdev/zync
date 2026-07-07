export function inferSeparator(cwd: string | undefined): string {
  if (cwd?.includes('\\')) return '\\';
  return '/';
}

export function isAbsoluteOrHomePath(path: string): boolean {
  return (
    path.startsWith('/')
    || path.startsWith('~')
    || /^[A-Za-z]:[/\\]/.test(path)
    || path.startsWith('\\\\')
  );
}

export function resolveDir(dir: string, cwd: string, sep: string): string {
  if (isAbsoluteOrHomePath(dir)) {
    return dir;
  }

  const base = cwd.endsWith(sep) ? cwd.slice(0, -1) : cwd;
  let resolved: string;
  if (dir.startsWith('./') || dir.startsWith('.\\')) {
    resolved = `${base}${sep}${dir.slice(2)}`;
  } else {
    resolved = `${base}${sep}${dir}`;
  }

  return sep === '\\' ? resolved.replace(/\//g, '\\') : resolved.replace(/\\/g, '/');
}

export function stripTrailingSep(path: string): string {
  if (path === '/' || /^[A-Za-z]:[/\\]$/.test(path)) return path;
  return path.replace(/[/\\]+$/, '');
}