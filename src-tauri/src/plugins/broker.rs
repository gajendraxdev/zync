use super::package::digest_directory;
use super::{Manifest, PluginScanner};
use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

const REQUEST_WINDOW: Duration = Duration::from_secs(10);
const MAX_REQUESTS_PER_WINDOW: u32 = 30;
const PACKAGE_DIGEST_RECHECK_INTERVAL: Duration = Duration::from_secs(1);

pub struct PluginBrokerState {
    runtimes: Mutex<HashMap<String, RuntimeRecord>>,
}

#[derive(Clone)]
pub struct PluginRuntimePrincipal {
    pub plugin_id: String,
    pub publisher_id: String,
}

#[derive(Clone)]
pub struct PluginNetworkGrant {
    pub(super) allowed_hosts: Vec<String>,
}

impl PluginNetworkGrant {
    pub fn allows_host(&self, host: &str) -> bool {
        self.allowed_hosts
            .iter()
            .any(|allowed| network_host_matches(allowed, host))
    }
}

struct RuntimeRecord {
    plugin_id: String,
    plugin_path: String,
    package_digest: String,
    package_digest_verified_at: Instant,
    manifest: Manifest,
    window_started: Instant,
    requests_in_window: u32,
    pane_connections: HashMap<String, String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRuntimeRegistration {
    pub runtime_instance_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginPaneRegistration {
    pub id: String,
    pub title: String,
    pub html: String,
    pub allow_multiple: bool,
    pub legacy: bool,
}

impl PluginBrokerState {
    pub fn new() -> Self {
        Self {
            runtimes: Mutex::new(HashMap::new()),
        }
    }

    pub fn start_runtime(
        &self,
        app: &AppHandle,
        plugin_id: &str,
    ) -> Result<PluginRuntimeRegistration> {
        let plugin = PluginScanner::scan(app)?
            .into_iter()
            .find(|plugin| plugin.manifest.id == plugin_id)
            .ok_or_else(|| anyhow!("Plugin is not installed"))?;
        if !plugin.enabled || plugin.script.is_none() {
            return Err(anyhow!("Plugin is disabled or has no worker runtime"));
        }

        let package_digest =
            runtime_package_digest(&plugin.path, plugin_id, &plugin.manifest.version)?;
        let runtime_instance_id = uuid::Uuid::new_v4().to_string();
        let mut runtimes = self
            .runtimes
            .lock()
            .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
        runtimes.retain(|_, runtime| runtime.plugin_id != plugin_id);
        runtimes.insert(
            runtime_instance_id.clone(),
            RuntimeRecord {
                plugin_id: plugin_id.to_string(),
                plugin_path: plugin.path,
                package_digest,
                package_digest_verified_at: Instant::now(),
                manifest: plugin.manifest,
                window_started: Instant::now(),
                requests_in_window: 0,
                pane_connections: HashMap::new(),
            },
        );
        Ok(PluginRuntimeRegistration {
            runtime_instance_id,
        })
    }

    pub fn stop_runtime(&self, runtime_instance_id: &str) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            runtimes.remove(runtime_instance_id);
        }
    }

    pub fn stop_plugin(&self, plugin_id: &str) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            runtimes.retain(|_, runtime| runtime.plugin_id != plugin_id);
        }
    }

    pub fn reset(&self) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            runtimes.clear();
        }
    }

    pub fn authorize(
        &self,
        app: &AppHandle,
        runtime_instance_id: &str,
        capability: &str,
    ) -> Result<()> {
        let (plugin_id, plugin_path, expected_digest, manifest, digest_recheck_due) = {
            let mut runtimes = self
                .runtimes
                .lock()
                .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
            let runtime = runtimes
                .get_mut(runtime_instance_id)
                .ok_or_else(|| anyhow!("Plugin runtime is no longer active"))?;
            consume_request_budget(runtime)?;
            (
                runtime.plugin_id.clone(),
                runtime.plugin_path.clone(),
                runtime.package_digest.clone(),
                runtime.manifest.clone(),
                package_digest_recheck_due(runtime.package_digest_verified_at, Instant::now()),
            )
        };

        if !PluginScanner::is_enabled(app, &plugin_id)? {
            return Err(anyhow!("Plugin is disabled"));
        }
        let current_digest = if digest_recheck_due {
            let digest = runtime_package_digest(&plugin_path, &manifest.id, &manifest.version)?;
            if digest != expected_digest {
                return Err(anyhow!("Plugin package changed after this runtime started"));
            }
            let mut runtimes = self
                .runtimes
                .lock()
                .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
            let runtime = runtimes
                .get_mut(runtime_instance_id)
                .ok_or_else(|| anyhow!("Plugin runtime is no longer active"))?;
            if runtime.package_digest != expected_digest {
                return Err(anyhow!("Plugin package changed after this runtime started"));
            }
            runtime.package_digest_verified_at = Instant::now();
            digest
        } else {
            expected_digest.clone()
        };

        if manifest.manifest_version() < 2 {
            // Compatibility runtimes retain legacy access until the migration window closes.
            return Ok(());
        }
        if capability == "legacy.compatibility" {
            return Err(anyhow!(
                "Legacy plugin API is unavailable to Manifest v2 plugins"
            ));
        }
        let declared = manifest
            .extensions
            .permissions
            .as_ref()
            .is_some_and(|permissions| {
                permissions
                    .required
                    .iter()
                    .chain(permissions.optional.iter())
                    .any(|permission| permission.id == capability)
            });
        if !declared {
            return Err(anyhow!("Plugin did not declare capability {capability}"));
        }
        if !super::grants::is_capability_granted(app, &manifest, &current_digest, capability) {
            return Err(anyhow!("Plugin permission is not granted: {capability}"));
        }
        Ok(())
    }

    pub fn authorize_command_registration(
        &self,
        app: &AppHandle,
        runtime_instance_id: &str,
        command_id: &str,
        title: &str,
    ) -> Result<()> {
        self.authorize(app, runtime_instance_id, "ui.commands.register")?;
        let runtimes = self
            .runtimes
            .lock()
            .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
        let runtime = runtimes
            .get(runtime_instance_id)
            .ok_or_else(|| anyhow!("Plugin runtime is no longer active"))?;
        if runtime.manifest.manifest_version() < 2 {
            return Ok(());
        }
        if manifest_allows_command(&runtime.manifest, command_id, title) {
            Ok(())
        } else {
            Err(anyhow!(
                "Command is not declared by this plugin: {command_id}"
            ))
        }
    }

    pub fn authorize_principal(
        &self,
        app: &AppHandle,
        runtime_instance_id: &str,
        capability: &str,
    ) -> Result<PluginRuntimePrincipal> {
        self.authorize(app, runtime_instance_id, capability)?;
        let runtimes = self
            .runtimes
            .lock()
            .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
        let runtime = runtimes
            .get(runtime_instance_id)
            .ok_or_else(|| anyhow!("Plugin runtime is no longer active"))?;
        Ok(PluginRuntimePrincipal {
            plugin_id: runtime.plugin_id.clone(),
            publisher_id: runtime
                .manifest
                .extensions
                .publisher
                .clone()
                .unwrap_or_else(|| "_legacy".into()),
        })
    }

    pub fn authorize_network_fetch(
        &self,
        app: &AppHandle,
        runtime_instance_id: &str,
    ) -> Result<PluginNetworkGrant> {
        self.authorize(app, runtime_instance_id, "network.fetch")?;
        let runtimes = self
            .runtimes
            .lock()
            .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
        let runtime = runtimes
            .get(runtime_instance_id)
            .ok_or_else(|| anyhow!("Plugin runtime is no longer active"))?;
        let allowed_hosts = runtime
            .manifest
            .extensions
            .permissions
            .as_ref()
            .and_then(|permissions| {
                permissions
                    .required
                    .iter()
                    .chain(permissions.optional.iter())
                    .find(|permission| permission.id == "network.fetch")
            })
            .map(|permission| permission.hosts.clone())
            .unwrap_or_default();
        if allowed_hosts.is_empty() {
            return Err(anyhow!("network.fetch has no approved hosts"));
        }
        Ok(PluginNetworkGrant { allowed_hosts })
    }

    pub fn register_pane(
        &self,
        app: &AppHandle,
        runtime_instance_id: &str,
        pane_kind_id: &str,
    ) -> Result<Option<PluginPaneRegistration>> {
        self.authorize(app, runtime_instance_id, "ui.pane.register")?;
        let (plugin_id, plugin_path, manifest) = {
            let runtimes = self
                .runtimes
                .lock()
                .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
            let runtime = runtimes
                .get(runtime_instance_id)
                .ok_or_else(|| anyhow!("Plugin runtime is no longer active"))?;
            (
                runtime.plugin_id.clone(),
                runtime.plugin_path.clone(),
                runtime.manifest.clone(),
            )
        };
        if manifest.manifest_version() < 2 {
            return Ok(None);
        }
        let contribution = manifest
            .extensions
            .contributes
            .as_ref()
            .and_then(|contributions| {
                contributions
                    .pane_kinds
                    .iter()
                    .find(|pane| pane.id == pane_kind_id)
            })
            .ok_or_else(|| anyhow!("Pane kind is not declared by this plugin: {pane_kind_id}"))?;
        let html = read_pane_entry(Path::new(&plugin_path), &contribution.entry)?;
        Ok(Some(PluginPaneRegistration {
            id: format!("{plugin_id}:{}", contribution.id),
            title: contribution.title.clone(),
            html,
            allow_multiple: contribution.allow_multiple,
            legacy: false,
        }))
    }

    pub fn bind_pane_connection(
        &self,
        runtime_instance_id: &str,
        pane_kind_id: &str,
        pane_instance_id: &str,
        connection_id: &str,
    ) -> Result<()> {
        if pane_instance_id.is_empty() || pane_instance_id.len() > 256 {
            return Err(anyhow!("Plugin pane instance id is invalid"));
        }
        if connection_id.is_empty() || connection_id.len() > 256 {
            return Err(anyhow!("Plugin pane connection is invalid"));
        }
        let mut runtimes = self
            .runtimes
            .lock()
            .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
        let runtime = runtimes
            .get_mut(runtime_instance_id)
            .ok_or_else(|| anyhow!("Plugin runtime is no longer active"))?;
        if runtime.manifest.manifest_version() >= 2 {
            let expected_prefix = format!("{}:", runtime.plugin_id);
            let contribution_id = pane_kind_id
                .strip_prefix(&expected_prefix)
                .ok_or_else(|| anyhow!("Plugin pane kind belongs to another plugin"))?;
            let declared = runtime
                .manifest
                .extensions
                .contributes
                .as_ref()
                .is_some_and(|contributions| {
                    contributions
                        .pane_kinds
                        .iter()
                        .any(|pane| pane.id == contribution_id)
                });
            if !declared {
                return Err(anyhow!("Plugin pane kind is not declared"));
            }
        }
        runtime
            .pane_connections
            .insert(pane_instance_id.to_string(), connection_id.to_string());
        Ok(())
    }

    pub fn unbind_pane_connection(&self, runtime_instance_id: &str, pane_instance_id: &str) {
        if let Ok(mut runtimes) = self.runtimes.lock() {
            if let Some(runtime) = runtimes.get_mut(runtime_instance_id) {
                runtime.pane_connections.remove(pane_instance_id);
            }
        }
    }

    pub fn authorize_pane_connection(
        &self,
        app: &AppHandle,
        runtime_instance_id: &str,
        pane_instance_id: &str,
        capability: &str,
    ) -> Result<String> {
        self.authorize(app, runtime_instance_id, capability)?;
        let runtimes = self
            .runtimes
            .lock()
            .map_err(|_| anyhow!("Plugin broker state is unavailable"))?;
        let runtime = runtimes
            .get(runtime_instance_id)
            .ok_or_else(|| anyhow!("Plugin runtime is no longer active"))?;
        runtime
            .pane_connections
            .get(pane_instance_id)
            .cloned()
            .ok_or_else(|| anyhow!("Plugin pane is not bound to a live connection"))
    }
}

const MAX_PANE_HTML_BYTES: u64 = 512 * 1024;

fn read_pane_entry(plugin_root: &Path, entry: &str) -> Result<String> {
    let canonical_root = fs::canonicalize(plugin_root).context("Failed to resolve plugin root")?;
    let entry_path =
        fs::canonicalize(plugin_root.join(entry)).context("Failed to resolve plugin pane entry")?;
    if !entry_path.starts_with(&canonical_root) {
        return Err(anyhow!("Plugin pane entry escapes the package"));
    }
    let metadata = fs::metadata(&entry_path).context("Failed to inspect plugin pane entry")?;
    if !metadata.is_file() || metadata.len() > MAX_PANE_HTML_BYTES {
        return Err(anyhow!("Plugin pane entry is missing or too large"));
    }
    fs::read_to_string(entry_path).context("Failed to read plugin pane entry")
}

fn manifest_allows_command(manifest: &Manifest, command_id: &str, title: &str) -> bool {
    manifest
        .extensions
        .contributes
        .as_ref()
        .is_some_and(|contributions| {
            contributions
                .commands
                .iter()
                .any(|command| command.id == command_id && command.title == title)
        })
}

fn network_host_matches(pattern: &str, host: &str) -> bool {
    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    let normalized_pattern = pattern.trim_end_matches('.').to_ascii_lowercase();
    if let Some(suffix) = normalized_pattern.strip_prefix("*.") {
        normalized_host
            .strip_suffix(suffix)
            .is_some_and(|prefix| prefix.ends_with('.') && prefix.len() > 1)
    } else {
        normalized_host == normalized_pattern
    }
}

fn runtime_package_digest(path: &str, plugin_id: &str, version: &str) -> Result<String> {
    if path.starts_with("builtin://") {
        return Ok(format!("builtin:{plugin_id}:{version}"));
    }
    digest_directory(Path::new(path)).context("Failed to verify plugin package contents")
}

fn package_digest_recheck_due(verified_at: Instant, now: Instant) -> bool {
    now.duration_since(verified_at) >= PACKAGE_DIGEST_RECHECK_INTERVAL
}

fn consume_request_budget(runtime: &mut RuntimeRecord) -> Result<()> {
    let now = Instant::now();
    if now.duration_since(runtime.window_started) >= REQUEST_WINDOW {
        runtime.window_started = now;
        runtime.requests_in_window = 0;
    }
    if runtime.requests_in_window >= MAX_REQUESTS_PER_WINDOW {
        return Err(anyhow!("Plugin request rate limit exceeded"));
    }
    runtime.requests_in_window += 1;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_budget_resets_and_rejects_floods() {
        let mut runtime = RuntimeRecord {
            plugin_id: "dev.example.demo".into(),
            plugin_path: "builtin://test".into(),
            package_digest: "sha256:test".into(),
            package_digest_verified_at: Instant::now(),
            manifest: serde_json::from_str(include_str!(
                "../../../examples/plugins/manifest-v2-demo/manifest.json"
            ))
            .expect("parse manifest"),
            window_started: Instant::now(),
            requests_in_window: 0,
            pane_connections: HashMap::new(),
        };
        for _ in 0..MAX_REQUESTS_PER_WINDOW {
            consume_request_budget(&mut runtime).expect("request inside limit");
        }
        assert!(consume_request_budget(&mut runtime).is_err());
        runtime.window_started = Instant::now() - REQUEST_WINDOW;
        consume_request_budget(&mut runtime).expect("new window resets budget");
        assert_eq!(runtime.requests_in_window, 1);
    }

    #[test]
    fn pane_connection_binding_requires_this_plugins_declared_pane() {
        let broker = PluginBrokerState::new();
        let runtime_instance_id = "runtime-a";
        broker.runtimes.lock().expect("runtime lock").insert(
            runtime_instance_id.into(),
            RuntimeRecord {
                plugin_id: "dev.zync.examples.manifest-v2-demo".into(),
                plugin_path: "builtin://test".into(),
                package_digest: "sha256:test".into(),
                package_digest_verified_at: Instant::now(),
                manifest: serde_json::from_str(include_str!(
                    "../../../examples/plugins/manifest-v2-demo/manifest.json"
                ))
                .expect("parse manifest"),
                window_started: Instant::now(),
                requests_in_window: 0,
                pane_connections: HashMap::new(),
            },
        );

        assert!(broker
            .bind_pane_connection(
                runtime_instance_id,
                "dev.zync.examples.manifest-v2-demo:demo.counter",
                "pane-a",
                "connection-a",
            )
            .is_ok());
        assert!(broker
            .bind_pane_connection(
                runtime_instance_id,
                "dev.example.other:demo.counter",
                "pane-b",
                "connection-b",
            )
            .is_err());
        broker.unbind_pane_connection(runtime_instance_id, "pane-a");
        assert!(broker
            .runtimes
            .lock()
            .expect("runtime lock")
            .get(runtime_instance_id)
            .expect("runtime")
            .pane_connections
            .is_empty());
    }

    #[test]
    fn network_hosts_match_exactly_or_as_real_subdomains() {
        assert!(network_host_matches("api.example.com", "API.EXAMPLE.COM"));
        assert!(network_host_matches("*.example.com", "one.example.com"));
        assert!(network_host_matches(
            "*.example.com",
            "deep.one.example.com"
        ));
        assert!(!network_host_matches("*.example.com", "example.com"));
        assert!(!network_host_matches("*.example.com", "badexample.com"));
    }

    #[test]
    fn package_digest_recheck_uses_a_short_cache_window() {
        let now = Instant::now();
        assert!(!package_digest_recheck_due(now, now));
        assert!(package_digest_recheck_due(
            now - PACKAGE_DIGEST_RECHECK_INTERVAL,
            now
        ));
    }

    #[test]
    fn command_registration_must_match_the_manifest_contribution() {
        let manifest: Manifest = serde_json::from_str(include_str!(
            "../../../examples/plugins/manifest-v2-demo/manifest.json"
        ))
        .expect("parse manifest");
        assert!(manifest_allows_command(
            &manifest,
            "manifest-v2-demo.hello",
            "Manifest v2 Demo: Say hello",
        ));
        assert!(!manifest_allows_command(
            &manifest,
            "manifest-v2-demo.hidden",
            "Hidden command",
        ));
        assert!(!manifest_allows_command(
            &manifest,
            "manifest-v2-demo.hello",
            "Impersonated title",
        ));
    }

    #[test]
    fn pane_entry_is_loaded_from_the_package_not_the_worker_message() {
        let plugin_root =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples/plugins/manifest-v2-demo");
        let html = read_pane_entry(&plugin_root, "ui/counter.html").expect("read pane entry");
        assert!(html.contains("Isolated plugin pane"));
        assert!(read_pane_entry(&plugin_root, "../manifest.json").is_err());
    }
}
