use crate::commands::AppState;
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
