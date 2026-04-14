use crate::ghost::parser::extract_search_prefix;
use crate::ghost::ranking::{best_candidate_for_prefix, ranked_candidates_for_prefix};
use crate::ghost::types::{
    FrecencyEntry, GhostData, LegacyGhostData, ScopeHistory, MAX_HISTORY, MIN_PREFIX_LEN,
    SAVE_INTERVAL,
};
use std::collections::HashMap;
use std::path::PathBuf;
use tokio::sync::Mutex;

pub struct GhostManager {
    data: Mutex<GhostData>,
    persist_path: PathBuf,
    commit_count: Mutex<u32>,
}

impl GhostManager {
    /// Create a manager, loading persisted history from `data_dir` if available.
    pub fn new(data_dir: &PathBuf) -> Self {
        let persist_path = data_dir.join("ghost_history.json");

        let data = std::fs::read_to_string(&persist_path)
            .ok()
            .and_then(|s| {
                serde_json::from_str::<GhostData>(&s).ok().or_else(|| {
                    serde_json::from_str::<LegacyGhostData>(&s).ok().map(|legacy| {
                        let mut scopes = HashMap::new();
                        scopes.insert(
                            "local".to_string(),
                            ScopeHistory {
                                history: legacy.history,
                                scores: legacy.scores,
                            },
                        );
                        GhostData { scopes }
                    })
                })
            })
            .unwrap_or_default();

        let total_entries: usize = data.scopes.values().map(|s| s.history.len()).sum();

        eprintln!(
            "[Ghost] Loaded {} history entries across {} scopes from {:?}",
            total_entries,
            data.scopes.len(),
            persist_path
        );

        Self {
            data: Mutex::new(data),
            persist_path,
            commit_count: Mutex::new(0),
        }
    }

    /// Serialize to disk. Called while the data lock is held by the caller
    /// (we receive a reference to avoid a second lock).
    async fn save_inner(&self, data: &GhostData) {
        match serde_json::to_string(data) {
            Ok(json) => {
                if let Err(e) = tokio::fs::write(&self.persist_path, json).await {
                    eprintln!("[Ghost] Failed to persist history: {}", e);
                }
            }
            Err(e) => eprintln!("[Ghost] Failed to serialize history: {}", e),
        }
    }

    fn slice_suffix_case_insensitive<'a>(cmd: &'a str, prefix: &str) -> Option<&'a str> {
        let cmd_lower = cmd.to_lowercase();
        let prefix_lower = prefix.to_lowercase();
        if !cmd_lower.starts_with(&prefix_lower) || cmd_lower == prefix_lower {
            return None;
        }

        let prefix_chars = prefix.chars().count();
        let byte_idx = cmd
            .char_indices()
            .nth(prefix_chars)
            .map(|(i, _)| i)
            .unwrap_or(cmd.len());
        cmd.get(byte_idx..)
    }

    fn normalize_scope(scope: Option<&str>) -> String {
        let s = scope.unwrap_or("local").trim();
        if s.is_empty() {
            "local".to_string()
        } else {
            s.to_string()
        }
    }

    /// Add `command` to history and bump its frecency score.
    pub async fn commit(&self, command: String, scope: Option<&str>) {
        let trimmed = command.trim().to_string();
        if trimmed.len() < MIN_PREFIX_LEN {
            return;
        }

        let mut data = self.data.lock().await;
        let scope_key = Self::normalize_scope(scope);
        let scope_data = data.scopes.entry(scope_key).or_default();

        // Dedup — remove existing, prepend so most-recent is always index 0.
        scope_data.history.retain(|e| e != &trimmed);
        scope_data.history.insert(0, trimmed.clone());
        if scope_data.history.len() > MAX_HISTORY {
            scope_data.history.truncate(MAX_HISTORY);
        }

        // Frecency bump.
        scope_data
            .scores
            .entry(trimmed)
            .or_insert_with(FrecencyEntry::new_with_bump)
            .bump();

        // Periodic save.
        let should_save = {
            let mut count = self.commit_count.lock().await;
            *count += 1;
            if *count >= SAVE_INTERVAL {
                *count = 0;
                true
            } else {
                false
            }
        };

        let snapshot = if should_save {
            Some(data.clone())
        } else {
            None
        };
        drop(data);

        if let Some(snapshot) = snapshot {
            self.save_inner(&snapshot).await;
        }
    }

    /// Return the best-scoring suffix that completes `prefix`, or `None`.
    ///
    /// Matching runs in two tiers (fish-style inline autosuggest):
    ///   Tier 1 — case-sensitive prefix
    ///   Tier 2 — case-insensitive prefix
    pub async fn suggest(&self, prefix: String, scope: Option<&str>) -> Option<String> {
        let Some(trimmed_prefix) = extract_search_prefix(&prefix) else {
            return None;
        };

        let data = self.data.lock().await;
        let scope_key = Self::normalize_scope(scope);
        let Some(scope_data) = data.scopes.get(&scope_key) else {
            return None;
        };

        // ── Tier 1: case-sensitive prefix ────────────────────────────────────────
        let t1 = best_candidate_for_prefix(scope_data, &trimmed_prefix, false);
        if let Some(cmd) = t1 {
            return Some(cmd[trimmed_prefix.len()..].to_string());
        }

        // ── Tier 2: case-insensitive prefix ──────────────────────────────────────
        let t2 = best_candidate_for_prefix(scope_data, &trimmed_prefix, true);
        if let Some(cmd) = t2 {
            if let Some(suffix) = Self::slice_suffix_case_insensitive(cmd, &trimmed_prefix) {
                return Some(suffix.to_string());
            }
        }

        None
    }

    /// Called when the user explicitly accepts a suggestion (Tab / →).
    /// Gives an extra frecency bump and saves immediately.
    pub async fn accept(&self, command: String, scope: Option<&str>) {
        let trimmed = command.trim().to_string();
        if trimmed.len() < MIN_PREFIX_LEN {
            return;
        }

        let mut data = self.data.lock().await;
        let scope_key = Self::normalize_scope(scope);
        let scope_data = data.scopes.entry(scope_key).or_default();

        let entry = scope_data
            .scores
            .entry(trimmed.clone())
            .or_insert_with(FrecencyEntry::new_with_bump);
        entry.bump(); // one extra bump on top of the commit bump

        // Guarantee it's in history.
        if !scope_data.history.contains(&trimmed) {
            scope_data.history.insert(0, trimmed);
            if scope_data.history.len() > MAX_HISTORY {
                scope_data.history.truncate(MAX_HISTORY);
            }
        }

        let snapshot = data.clone();
        drop(data);

        // Always persist on explicit accept.
        self.save_inner(&snapshot).await;
    }

    pub async fn candidates(
        &self,
        prefix: String,
        scope: Option<&str>,
        limit: usize,
    ) -> Vec<String> {
        let Some(trimmed_prefix) = extract_search_prefix(&prefix) else {
            return Vec::new();
        };

        let data = self.data.lock().await;
        let scope_key = Self::normalize_scope(scope);
        let Some(scope_data) = data.scopes.get(&scope_key) else {
            return Vec::new();
        };

        let lim = limit.clamp(1, 64);
        let mut out = ranked_candidates_for_prefix(scope_data, &trimmed_prefix, false, lim);
        if out.len() < lim {
            let more = ranked_candidates_for_prefix(
                scope_data,
                &trimmed_prefix,
                true,
                lim.saturating_sub(out.len()),
            );
            for suffix in more {
                if !out.contains(&suffix) {
                    out.push(suffix);
                    if out.len() >= lim {
                        break;
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::GhostManager;
    use std::path::PathBuf;

    fn test_dir(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("zync-ghost-test-{}-{}", name, std::process::id()));
        let _ = std::fs::create_dir_all(&p);
        p
    }

    #[tokio::test]
    async fn scope_isolation_for_suggestions() {
        let dir = test_dir("scope-isolation");
        let mgr = GhostManager::new(&dir);

        mgr.commit("git status".to_string(), Some("server-a")).await;
        mgr.commit("kubectl get pods".to_string(), Some("server-b"))
            .await;

        let a = mgr
            .suggest("git st".to_string(), Some("server-a"))
            .await
            .unwrap_or_default();
        let b = mgr
            .suggest("git st".to_string(), Some("server-b"))
            .await
            .unwrap_or_default();

        assert_eq!(a, "atus");
        assert_eq!(b, "");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn empty_scope_normalizes_to_local() {
        let local = GhostManager::normalize_scope(Some("  "));
        assert_eq!(local, "local");
        let explicit = GhostManager::normalize_scope(Some("server-x"));
        assert_eq!(explicit, "server-x");
    }
}
