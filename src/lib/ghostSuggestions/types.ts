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

export interface InlineSuggestionParams {
  line: string;
  cwd?: string;
  scope: string;
  /** Connection id for `fs_list` (defaults to scope). */
  fsConnectionId?: string;
  /** When set to `wsl` / `wsl:Distro`, path listing uses the WSL Linux filesystem. */
  wslShellId?: string;
  providers?: GhostSuggestionProviders;
}