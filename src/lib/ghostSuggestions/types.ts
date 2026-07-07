export interface GhostScopeRequest {
  /** Scope key: connection id or "local". */
  scope: string;
}

export interface GhostCommitRequest extends GhostScopeRequest {
  command: string;
}

export interface GhostSuggestRequest extends GhostScopeRequest {
  prefix: string;
}

export interface GhostSuggestionProviders {
  history: boolean;
  filesystem: boolean;
}

/** P5 backend-first suggest request. */
export interface GhostSuggestV2Request extends GhostScopeRequest {
  prefix: string;
  cwd?: string;
  shellId?: string;
  fsConnectionId?: string;
  recentCommands?: string[];
  providers?: GhostSuggestionProviders;
  /** When true, response includes raw suffix + spacing decision. */
  debug?: boolean;
}

export interface GhostSuggestV2Response {
  suffix: string;
  confidence: number;
  suppressReason?: string;
  rawSuffix?: string;
  spacingReason?: string;
}

export interface GhostSeedRemoteHistoryRequest {
  connectionId: string;
  scope?: string;
  homePath: string;
}

export interface GhostSeedRemoteHistoryResponse {
  imported: number;
  skippedReason?: string;
}

export interface InlineSuggestionParams {
  line: string;
  cwd?: string;
  scope: string;
  /** Connection id for `fs_list` (defaults to scope). */
  fsConnectionId?: string;
  /** When set to `wsl` / `wsl:Distro`, path listing uses the WSL Linux filesystem. */
  wslShellId?: string;
  /** Recent in-session commands from scrollback (P6 ranking). */
  recentCommands?: string[];
  providers?: GhostSuggestionProviders;
}