import {
  getPathSuggestion,
  getLastArg,
  getCommandName as getCommandNameFull,
  FILE_AWARE_COMMANDS,
  hasUnmatchedQuoteOnActiveToken,
  isBareDirectoryListingLine,
} from './pathCompletion';
import { WSL_FS_LIST_TIMEOUT_MS } from './wslShell';
import { cwdForWslPathCompletion, shellIdIndicatesWsl } from './wslShell';
import type {
  GhostCommitRequest,
  GhostSuggestionProviders,
  GhostSuggestRequest,
  InlineSuggestionParams,
} from './types';

const INLINE_FS_TIMEOUT_MS = 160;

export async function fetchHistorySuggestion(
  line: string,
  scope: string,
): Promise<string | null> {
  const request: GhostSuggestRequest = { prefix: line, scope };
  return window.ipcRenderer
    .invoke('ghost_suggest', { request })
    .catch(() => null) as Promise<string | null>;
}

export async function commitGhostCommand(command: string, scope: string): Promise<void> {
  const request: GhostCommitRequest = { command, scope };
  await window.ipcRenderer.invoke('ghost_commit', { request });
}

export async function acceptGhostCommand(command: string, scope: string): Promise<void> {
  const request: GhostCommitRequest = { command, scope };
  await window.ipcRenderer.invoke('ghost_accept', { request });
}

export async function resolveInlineSuggestion({
  line,
  cwd,
  scope,
  fsConnectionId,
  wslShellId,
  providers,
}: InlineSuggestionParams): Promise<string> {
  if (!shouldUseGhostForLine(line)) {
    return '';
  }

  const enabledProviders: GhostSuggestionProviders = {
    history: providers?.history ?? true,
    filesystem: providers?.filesystem ?? true,
  };

  const preferPath = shouldPreferPathSuggestion(line);
  const listConnectionId = fsConnectionId ?? scope;
  const listCwd = wslShellId ? cwdForWslPathCompletion(cwd) : cwd;
  const fsTimeoutMs = wslShellId && shellIdIndicatesWsl(wslShellId)
    ? WSL_FS_LIST_TIMEOUT_MS
    : INLINE_FS_TIMEOUT_MS;

  if (preferPath && enabledProviders.filesystem) {
    const fsSuffix = await getPathSuggestion(
      line,
      listCwd,
      listConnectionId,
      fsTimeoutMs,
      wslShellId,
    ).catch(() => null);
    if (fsSuffix) return fsSuffix;
  }

  const skipHistoryForBareCd = preferPath
    && enabledProviders.filesystem
    && isBareDirectoryListingLine(line);

  if (enabledProviders.history && !skipHistoryForBareCd) {
    const historySuffix = await fetchHistorySuggestion(line, scope);
    if (historySuffix) return historySuffix;
  }

  if (!preferPath && enabledProviders.filesystem) {
    const fsSuffix = await getPathSuggestion(
      line,
      listCwd,
      listConnectionId,
      fsTimeoutMs,
      wslShellId,
    ).catch(() => null);
    if (fsSuffix) return fsSuffix;
  }

  return '';
}

export function shouldPreferPathSuggestion(line: string): boolean {
  if (isFilesystemCommand(line)) {
    return true;
  }
  const lastArg = getLastArg(line);
  return lastArg.includes('/') || lastArg.includes('\\');
}

function isDirectoryCommand(line: string): boolean {
  const command = getCommandNameFull(line);
  return command === 'cd' || command === 'pushd' || command === 'popd';
}

function isFilesystemCommand(line: string): boolean {
  return isDirectoryCommand(line) || FILE_AWARE_COMMANDS.has(getCommandNameFull(line));
}

function shouldUseGhostForLine(line: string): boolean {
  if (!getCommandNameFull(line)) return false;
  if (hasUnmatchedQuoteOnActiveToken(line)) return false;
  return true;
}