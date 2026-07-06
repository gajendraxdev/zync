import { ghostDebug, isGhostDebugEnabled } from './ghostDebug.js';
import { shellIdIndicatesWsl } from './wslShell.js';
import type {
  GhostCommitRequest,
  GhostSeedRemoteHistoryRequest,
  GhostSeedRemoteHistoryResponse,
  GhostSuggestV2Request,
  GhostSuggestV2Response,
  InlineSuggestionParams,
} from './types.js';

export async function fetchGhostSuggestionV2(
  request: GhostSuggestV2Request,
): Promise<GhostSuggestV2Response> {
  const empty: GhostSuggestV2Response = { suffix: '', confidence: 0 };
  return window.ipcRenderer
    .invoke('ghost_suggest_v2', { request })
    .catch(() => empty) as Promise<GhostSuggestV2Response>;
}

export async function commitGhostCommand(command: string, scope: string): Promise<void> {
  const request: GhostCommitRequest = { command, scope };
  await window.ipcRenderer.invoke('ghost_commit', { request });
}

export async function acceptGhostCommand(command: string, scope: string): Promise<void> {
  const request: GhostCommitRequest = { command, scope };
  await window.ipcRenderer.invoke('ghost_accept', { request });
}

export async function seedRemoteGhostHistory(
  request: GhostSeedRemoteHistoryRequest,
): Promise<GhostSeedRemoteHistoryResponse> {
  const empty: GhostSeedRemoteHistoryResponse = { imported: 0 };
  return window.ipcRenderer
    .invoke('ghost_seed_remote_history', { request })
    .catch(() => empty) as Promise<GhostSeedRemoteHistoryResponse>;
}

export async function resolveInlineSuggestion({
  line,
  cwd,
  scope,
  fsConnectionId,
  wslShellId,
  recentCommands,
  providers,
}: InlineSuggestionParams): Promise<string> {
  const request: GhostSuggestV2Request = {
    prefix: line,
    scope,
    cwd,
    shellId: wslShellId,
    fsConnectionId: fsConnectionId ?? scope,
    recentCommands,
    providers,
    debug: isGhostDebugEnabled(),
  };

  ghostDebug('resolve', {
    phase: 'v2-request',
    line,
    scope,
    cwd: cwd ?? null,
    wslShellId: wslShellId ?? null,
    providers: providers ?? null,
  });

  const response = await fetchGhostSuggestionV2(request);

  ghostDebug('resolve', {
    phase: response.suffix ? 'v2-hit' : 'v2-empty',
    line,
    suffix: response.suffix || null,
    rawSuffix: response.rawSuffix ?? null,
    spacingReason: response.spacingReason ?? null,
    confidence: response.confidence,
    suppressReason: response.suppressReason ?? null,
  });

  return response.suffix;
}

/** Warm Rust path cache after WSL terminal-ready (wsl.exe cold start). */
export function prefetchWslHomeListing(shellId: string, cwd?: string): void {
  if (!shellIdIndicatesWsl(shellId)) return;
  void fetchGhostSuggestionV2({
    prefix: 'cd',
    scope: 'local',
    cwd,
    shellId,
    fsConnectionId: 'local',
    providers: { history: false, filesystem: true },
  }).catch(() => {});
}

export { shouldPreferPathSuggestion } from './commandTokens.js';