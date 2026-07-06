use crate::commands::AppState;
use crate::ghost::history_seed::{
    seed_remote_shell_history, GhostSeedRemoteHistoryRequest, GhostSeedRemoteHistoryResponse,
};
use crate::ghost::suggest_engine;
use crate::ghost::GhostSuggestV2Request;
use crate::ghost::GhostSuggestV2Response;
use serde::Deserialize;
use tauri::State;

const DEFAULT_GHOST_CANDIDATES_LIMIT: usize = 12;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostCommitRequest {
    pub command: String,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostSuggestRequest {
    pub prefix: String,
    pub scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostCandidatesRequest {
    pub prefix: String,
    pub scope: Option<String>,
    pub limit: Option<usize>,
}

#[tauri::command]
pub async fn ghost_commit(
    request: GhostCommitRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .ghost_manager
        .commit(request.command, request.scope.as_deref())
        .await;
    Ok(())
}

#[tauri::command]
pub async fn ghost_suggest(
    request: GhostSuggestRequest,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    Ok(state
        .ghost_manager
        .suggest(request.prefix, request.scope.as_deref())
        .await)
}

/// Backend-first inline ghost suggestion (P5): history + path in one Rust decision.
#[tauri::command]
pub async fn ghost_suggest_v2(
    request: GhostSuggestV2Request,
    state: State<'_, AppState>,
) -> Result<GhostSuggestV2Response, String> {
    Ok(suggest_engine::suggest_v2(request, &state.ghost_manager, &state).await)
}

/// One-time SSH shell-history import into scoped ghost store (P7, opt-in from frontend).
#[tauri::command]
pub async fn ghost_seed_remote_history(
    request: GhostSeedRemoteHistoryRequest,
    state: State<'_, AppState>,
) -> Result<GhostSeedRemoteHistoryResponse, String> {
    Ok(seed_remote_shell_history(request, &state.ghost_manager, &state).await)
}

#[tauri::command]
pub async fn ghost_accept(
    request: GhostCommitRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .ghost_manager
        .accept(request.command, request.scope.as_deref())
        .await;
    Ok(())
}

#[tauri::command]
pub async fn ghost_candidates(
    request: GhostCandidatesRequest,
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    Ok(state
        .ghost_manager
        .candidates(
            request.prefix,
            request.scope.as_deref(),
            request.limit.unwrap_or(DEFAULT_GHOST_CANDIDATES_LIMIT),
        )
        .await)
}
