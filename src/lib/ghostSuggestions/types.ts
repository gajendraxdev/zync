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

export interface GhostCandidatesRequest extends GhostScopeRequest {
  prefix: string;
  limit?: number;
}

export interface GhostSuggestionProviders {
  history: boolean;
  filesystem: boolean;
}

export interface GhostPopupState {
  visible: boolean;
  items: string[];
  /** Selected item index, always clamped to 0..items.length-1 when visible. */
  selectedIndex: number;
  anchorLine: string;
}

export type GhostPopupKeyAction =
  | { kind: 'next' }
  | { kind: 'prev' }
  | { kind: 'accept' }
  | { kind: 'dismiss' }
  | { kind: 'close_and_pass' };

export interface GhostTabState {
  lastLine: string;
  /** Unix timestamp in milliseconds (Date.now()). */
  lastAt: number;
}

export type GhostTabOutcome =
  | { kind: 'fallback' }
  | { kind: 'accept'; suffix: string; nextState: GhostTabState }
  | { kind: 'show_list'; items: string[]; nextState: GhostTabState };

interface SuggestionBaseParams {
  line: string;
  cwd?: string;
  scope: string;
  providers?: GhostSuggestionProviders;
}

export interface InlineSuggestionParams extends SuggestionBaseParams {}

export interface PopupCandidatesParams extends SuggestionBaseParams {
  preferPath: boolean;
  limit?: number;
}
