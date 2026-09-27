use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const RECOVERY_VERSION: u32 = 1;
const MAX_FAILURES_PER_PLUGIN: usize = 8;
const MAX_PLUGIN_ID_CHARS: usize = 160;
const MAX_FAILURE_AGE_MS: u64 = 24 * 60 * 60 * 1_000;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedPluginFailure {
    at_ms: u64,
    kind: String,
}

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryFile {
    version: u32,
    session_open: bool,
    safe_mode: bool,
    failures: BTreeMap<String, Vec<PersistedPluginFailure>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecoveryDiagnostic {
    pub plugin_id: String,
    pub failures: Vec<PluginRecoveryFailure>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecoveryFailure {
    pub at_ms: u64,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRecoveryStatus {
    pub safe_mode: bool,
    pub diagnostics: Vec<PluginRecoveryDiagnostic>,
}

pub struct PluginRecoveryState {
    file: Mutex<RecoveryFile>,
    path: PathBuf,
    startup_error: Option<String>,
}

impl PluginRecoveryState {
    pub fn load_and_begin(app: &AppHandle) -> Result<Self> {
        let path = recovery_path(app)?;
        Self::load_from_path(path)
    }

    fn load_from_path(path: PathBuf) -> Result<Self> {
        let (mut file, startup_error) = match load_recovery_file(&path) {
            Ok(file) => (file, None),
            Err(error) => (
                RecoveryFile {
                    version: RECOVERY_VERSION,
                    ..RecoveryFile::default()
                },
                Some(format!("Plugin recovery history is unavailable: {error:#}")),
            ),
        };
        if startup_error.is_none() {
            begin_session(&mut file, now_ms());
            save_recovery_file(&path, &file)?;
        }
        Ok(Self {
            file: Mutex::new(file),
            path,
            startup_error,
        })
    }

    fn ensure_available(&self) -> Result<()> {
        if let Some(error) = &self.startup_error {
            return Err(anyhow!(
                "{error}. Repair the recovery file and restart Zync."
            ));
        }
        Ok(())
    }

    pub fn status(&self) -> Result<PluginRecoveryStatus> {
        self.ensure_available()?;
        let mut file = self
            .file
            .lock()
            .map_err(|_| anyhow!("Plugin recovery state is unavailable"))?;
        prune_failures(&mut file, now_ms());
        Ok(status_from_file(&file))
    }

    pub fn record_failure(&self, plugin_id: &str, kind: &str) -> Result<()> {
        self.ensure_available()?;
        validate_plugin_id(plugin_id)?;
        if !matches!(kind, "worker-error" | "heartbeat-timeout" | "start-failure") {
            return Err(anyhow!("Unknown plugin runtime failure kind"));
        }
        let mut file = self
            .file
            .lock()
            .map_err(|_| anyhow!("Plugin recovery state is unavailable"))?;
        let now = now_ms();
        prune_failures(&mut file, now);
        let failures = file.failures.entry(plugin_id.to_string()).or_default();
        failures.push(PersistedPluginFailure {
            at_ms: now,
            kind: kind.to_string(),
        });
        if failures.len() > MAX_FAILURES_PER_PLUGIN {
            failures.drain(0..failures.len() - MAX_FAILURES_PER_PLUGIN);
        }
        save_recovery_file(&self.path, &file)
    }

    pub fn clear_safe_mode(&self) -> Result<()> {
        self.ensure_available()?;
        let mut file = self
            .file
            .lock()
            .map_err(|_| anyhow!("Plugin recovery state is unavailable"))?;
        file.safe_mode = false;
        save_recovery_file(&self.path, &file)
    }

    pub fn clear_plugin_failures(&self, plugin_id: &str) -> Result<()> {
        self.ensure_available()?;
        validate_plugin_id(plugin_id)?;
        let mut file = self
            .file
            .lock()
            .map_err(|_| anyhow!("Plugin recovery state is unavailable"))?;
        file.failures.remove(plugin_id);
        save_recovery_file(&self.path, &file)
    }

    pub fn mark_clean_exit(&self) -> Result<()> {
        self.ensure_available()?;
        let mut file = self
            .file
            .lock()
            .map_err(|_| anyhow!("Plugin recovery state is unavailable"))?;
        file.session_open = false;
        save_recovery_file(&self.path, &file)
    }
}

fn recovery_path(app: &AppHandle) -> Result<PathBuf> {
    Ok(app
        .path()
        .app_config_dir()
        .context("Failed to resolve app config directory")?
        .join("plugin-runtime-recovery.json"))
}

fn begin_session(file: &mut RecoveryFile, now: u64) {
    // An app restart is not evidence that any particular plugin crashed.
    // Clear legacy global safe mode while retaining per-plugin failure history.
    file.safe_mode = false;
    file.session_open = true;
    prune_failures(file, now);
}

fn load_recovery_file(path: &Path) -> Result<RecoveryFile> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(RecoveryFile {
                version: RECOVERY_VERSION,
                ..RecoveryFile::default()
            })
        }
        Err(error) => return Err(error).context("Failed to read plugin recovery state"),
    };
    let file: RecoveryFile =
        serde_json::from_slice(&bytes).context("Plugin recovery state is corrupt")?;
    if file.version != RECOVERY_VERSION {
        return Err(anyhow!("Unsupported plugin recovery state version"));
    }
    Ok(file)
}

fn save_recovery_file(path: &Path, file: &RecoveryFile) -> Result<()> {
    let bytes = serde_json::to_vec(file).context("Failed to serialize plugin recovery state")?;
    crate::atomic_io::durable_replace(path, &bytes).context("Failed to save plugin recovery state")
}

fn prune_failures(file: &mut RecoveryFile, now: u64) {
    let cutoff = now.saturating_sub(MAX_FAILURE_AGE_MS);
    file.failures.retain(|_, failures| {
        failures.retain(|failure| failure.at_ms >= cutoff);
        !failures.is_empty()
    });
}

fn status_from_file(file: &RecoveryFile) -> PluginRecoveryStatus {
    PluginRecoveryStatus {
        safe_mode: file.safe_mode,
        diagnostics: file
            .failures
            .iter()
            .map(|(plugin_id, failures)| PluginRecoveryDiagnostic {
                plugin_id: plugin_id.clone(),
                failures: failures
                    .iter()
                    .map(|failure| PluginRecoveryFailure {
                        at_ms: failure.at_ms,
                        kind: failure.kind.clone(),
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn validate_plugin_id(plugin_id: &str) -> Result<()> {
    let chars = plugin_id.chars().count();
    if chars == 0 || chars > MAX_PLUGIN_ID_CHARS || plugin_id.chars().any(char::is_control) {
        return Err(anyhow!("Invalid plugin id"));
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unreadable_history_blocks_status_and_never_overwrites_original() {
        let path =
            std::env::temp_dir().join(format!("zync-recovery-test-{}.json", uuid::Uuid::new_v4()));
        let original = b"not valid recovery JSON";
        fs::write(&path, original).unwrap();
        let state = PluginRecoveryState::load_from_path(path.clone()).unwrap();
        assert!(state.status().is_err());
        assert!(state.clear_safe_mode().is_err());
        assert!(state.clear_plugin_failures("dev.example.monitor").is_err());
        assert!(state
            .record_failure("dev.example.monitor", "worker-error")
            .is_err());
        assert!(state.mark_clean_exit().is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
        fs::remove_file(&path).unwrap();
    }

    #[test]
    fn restart_clears_global_safe_mode_and_preserves_plugin_failures() {
        let mut restarted = RecoveryFile {
            version: RECOVERY_VERSION,
            session_open: true,
            safe_mode: true,
            failures: BTreeMap::from([(
                "dev.example.monitor".into(),
                vec![PersistedPluginFailure {
                    at_ms: 100,
                    kind: "worker-error".into(),
                }],
            )]),
        };
        begin_session(&mut restarted, 200);
        assert!(!status_from_file(&restarted).safe_mode);
        assert!(restarted.session_open);
        assert_eq!(restarted.failures["dev.example.monitor"].len(), 1);
        begin_session(&mut restarted, 300);
        assert!(!status_from_file(&restarted).safe_mode);
        assert_eq!(restarted.failures["dev.example.monitor"].len(), 1);
    }

    #[test]
    fn diagnostics_contain_only_plugin_id_time_and_kind() {
        let file = RecoveryFile {
            version: RECOVERY_VERSION,
            session_open: true,
            safe_mode: false,
            failures: BTreeMap::from([(
                "dev.example.counter".into(),
                vec![PersistedPluginFailure {
                    at_ms: 42,
                    kind: "worker-error".into(),
                }],
            )]),
        };
        let status = status_from_file(&file);
        assert_eq!(status.diagnostics[0].plugin_id, "dev.example.counter");
        assert_eq!(status.diagnostics[0].failures[0].at_ms, 42);
        assert_eq!(status.diagnostics[0].failures[0].kind, "worker-error");
    }

    #[test]
    fn pruning_drops_old_events_and_empty_plugins() {
        let mut file = RecoveryFile {
            version: RECOVERY_VERSION,
            session_open: true,
            safe_mode: false,
            failures: BTreeMap::from([
                (
                    "old".into(),
                    vec![PersistedPluginFailure {
                        at_ms: 1,
                        kind: "worker-error".into(),
                    }],
                ),
                (
                    "new".into(),
                    vec![PersistedPluginFailure {
                        at_ms: MAX_FAILURE_AGE_MS + 10,
                        kind: "heartbeat-timeout".into(),
                    }],
                ),
            ]),
        };
        prune_failures(&mut file, MAX_FAILURE_AGE_MS + 20);
        assert!(!file.failures.contains_key("old"));
        assert!(file.failures.contains_key("new"));
    }
}
