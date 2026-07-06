/**
 * Inline ghost suppression for shells with strong native completion/autosuggest (P3).
 *
 * Fish ships inline autosuggest by default. Zsh only conflicts when the
 * zsh-autosuggestions plugin is present — Auto probes ~/.zshrc (and related init files)
 * once per terminal session before suppressing. WSL local tabs use wsl.exe to read the
 * Linux home init files instead of the Windows profile path.
 */

export type NativeShellPolicy = 'auto' | 'always' | 'off';

function shellIdIndicatesFish(shellId: string): boolean {
  return /fish/i.test(shellId);
}

export function shellIdIndicatesZsh(shellId: string): boolean {
  return /zsh/i.test(shellId);
}

function shellIdIndicatesBashOrSh(shellId: string): boolean {
  return /bash/i.test(shellId) || /(^|\/)sh$/i.test(shellId);
}

/** True when inline ghost should be suppressed for the active shell and policy. */
export function shouldSuppressGhostForNativeShell(
  policy: NativeShellPolicy | undefined,
  shellId?: string,
  zshAutosuggestEnabled?: boolean,
): boolean {
  const resolved = policy ?? 'auto';
  if (resolved === 'always' || !shellId) return false;

  const isFish = shellIdIndicatesFish(shellId);
  const isZsh = shellIdIndicatesZsh(shellId);

  if (resolved === 'auto') {
    if (isFish) return true;
    if (isZsh) return zshAutosuggestEnabled === true;
    return false;
  }

  return isFish || isZsh || shellIdIndicatesBashOrSh(shellId);
}