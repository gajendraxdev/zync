pub(crate) mod broker;
mod builtins;
pub(crate) mod filesystem;
mod grants;
pub(crate) mod install;
mod integrity;
pub(crate) mod management;
mod manifest;
pub(crate) mod network;
mod package;
pub(crate) mod recovery;
pub(crate) mod registry;
pub(crate) mod rollback;
pub(crate) mod ssh_filesystem;
pub(crate) mod storage;

pub use self::manifest::{EditorManifest, Manifest, ManifestExtensions};
use self::package::read_manifest_file;
use anyhow::{anyhow, Context, Result};
use log::info;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize)]
pub struct Plugin {
    pub path: String,
    pub manifest: Manifest,
    pub script: Option<String>,
    pub style: Option<String>,
    #[serde(rename = "editorHtml")]
    pub editor_html: Option<String>,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PluginState {
    enabled_plugins: HashMap<String, bool>,
}

pub struct PluginScanner;

impl PluginScanner {
    /// Scans the plugins directory and returns a list of loaded plugins.
    /// Plugins are located in `app_config_dir/plugins`.
    pub fn scan(app: &AppHandle) -> Result<Vec<Plugin>> {
        // Resolve configuration directory (e.g. ~/.config/zync on Linux)
        let config_dir = app
            .path()
            .app_config_dir()
            .context("Failed to resolve app config directory")?;

        let plugins_dir = config_dir.join("plugins");
        let state = Self::load_state(app)?;

        // Load User Plugins
        let mut plugins = Vec::new();
        if plugins_dir.exists() {
            for entry in fs::read_dir(plugins_dir)? {
                let entry = entry?;
                if !should_scan_plugin_dir(&entry.file_name()) {
                    continue;
                }
                let path = entry.path();

                if path.is_dir() {
                    if let Ok(mut plugin) = Self::load_plugin(&path) {
                        // Legacy packages keep their compatibility behavior until the migration
                        // window closes. Manifest v2 packages never run without a matching grant.
                        let approved = plugin.manifest.manifest_version() < 2
                            || package::digest_directory(&path).ok().is_some_and(|digest| {
                                grants::is_package_approved(app, &plugin.manifest, &digest)
                            });
                        // Check if enabled (default true if not present)
                        plugin.enabled = approved
                            && *state
                                .enabled_plugins
                                .get(&plugin.manifest.id)
                                .unwrap_or(&true);
                        plugins.push(plugin);
                    }
                }
            }
        }

        // Inject Built-in Plugins
        // Helper to inject and set enabled state
        let mut inject = |mut p: Plugin| {
            p.enabled = *state.enabled_plugins.get(&p.manifest.id).unwrap_or(&true);
            plugins.push(p);
        };

        inject(builtins::builtin_theme_manager());
        inject(builtins::builtin_codemirror_editor_provider());
        inject(builtins::builtin_plain_editor_provider());
        inject(builtins::builtin_dark());
        inject(builtins::builtin_dracula());
        inject(builtins::builtin_monokai());
        inject(builtins::builtin_midnight());
        inject(builtins::builtin_monokai_pro());
        inject(builtins::builtin_light());
        inject(builtins::builtin_gruvbox_light());
        inject(builtins::builtin_solarized_light());
        inject(builtins::builtin_catppuccin_latte());
        inject(builtins::builtin_tokyo_light());
        inject(builtins::builtin_synthwave());
        inject(builtins::builtin_nordic());

        Ok(plugins)
    }

    fn load_state(app: &AppHandle) -> Result<PluginState> {
        let config_dir = app
            .path()
            .app_config_dir()
            .context("Failed to resolve app config directory")?;
        let state_path = config_dir.join("plugins.json");

        if state_path.exists() {
            let content = fs::read_to_string(state_path)?;
            let state: PluginState = serde_json::from_str(&content)?;
            Ok(state)
        } else {
            Ok(PluginState::default())
        }
    }

    pub(super) fn is_enabled(app: &AppHandle, plugin_id: &str) -> Result<bool> {
        let state = Self::load_state(app)?;
        Ok(*state.enabled_plugins.get(plugin_id).unwrap_or(&true))
    }

    pub fn save_state(app: &AppHandle, id: String, enabled: bool) -> Result<()> {
        if enabled {
            grants::ensure_installed_plugin_is_approved(app, &id)?;
        }
        let config_dir = app
            .path()
            .app_config_dir()
            .context("Failed to resolve app config directory")?;
        if !config_dir.exists() {
            fs::create_dir_all(&config_dir)?;
        }

        let state_path = config_dir.join("plugins.json");
        let mut state = Self::load_state(app)?;

        state.enabled_plugins.insert(id, enabled);

        let content = serde_json::to_string_pretty(&state)?;
        fs::write(state_path, content)?;

        Ok(())
    }

    fn load_plugin(dir: &PathBuf) -> Result<Plugin> {
        let manifest_path = dir.join("manifest.json");
        let manifest_content = read_manifest_file(&manifest_path)
            .with_context(|| format!("Failed to read manifest.json in {dir:?}"))?;

        let manifest: Manifest =
            serde_json::from_str(&manifest_content).context("Failed to parse manifest.json")?;
        manifest
            .validate()
            .context("Plugin manifest validation failed")?;

        // Signed metadata is never advisory: if present, it must still match every payload byte
        // before the package can be loaded. Unsigned packages remain a Developer Mode concern.
        integrity::verify_package_signature(dir, &manifest)
            .context("Plugin package signature verification failed")?;

        let canonical_root = fs::canonicalize(dir)?;

        // Load Main Script (worker.js or specified entry)
        let script = if let Some(main_file) = manifest.runtime_entry() {
            Some(Self::read_plugin_text_asset(
                dir,
                &canonical_root,
                main_file,
                "manifest.main",
            )?)
        } else {
            let default_script = dir.join("worker.js");
            if default_script.exists() {
                let script_path = fs::canonicalize(default_script)?;
                if script_path.starts_with(&canonical_root) {
                    let content = fs::read_to_string(&script_path).with_context(|| {
                        format!(
                            "Failed to read default worker script from {}",
                            script_path.display()
                        )
                    })?;
                    info!(
                        "[Plugins] Loaded default worker script from: {}",
                        script_path.display()
                    );
                    Some(content)
                } else {
                    None
                }
            } else {
                None
            }
        };

        // Load Styles (if any)
        let style = if let Some(style_file) = &manifest.style {
            Some(Self::read_plugin_text_asset(
                dir,
                &canonical_root,
                style_file,
                "manifest.style",
            )?)
        } else {
            None
        };

        // Load editor panel HTML (if this plugin declares an editor-provider entry)
        let editor_html = if manifest.manifest_type.as_deref() == Some("editor-provider") {
            if let Some(entry_file) = manifest
                .editor
                .as_ref()
                .and_then(|editor| editor.entry.as_ref())
            {
                Some(Self::read_plugin_text_asset(
                    dir,
                    &canonical_root,
                    entry_file,
                    "manifest.editor.entry",
                )?)
            } else {
                None
            }
        } else {
            None
        };

        Ok(Plugin {
            path: dir.to_string_lossy().to_string(),
            manifest,
            script,
            style,
            editor_html,
            enabled: true, // Default, overwritten by scan
        })
    }

    fn read_plugin_text_asset(
        dir: &Path,
        canonical_root: &Path,
        relative_path: &str,
        field_name: &str,
    ) -> Result<String> {
        let asset_path = fs::canonicalize(dir.join(relative_path))
            .with_context(|| format!("Failed to resolve {field_name} path"))?;

        if !asset_path.starts_with(canonical_root) {
            return Err(anyhow!("Illegal {field_name} path: outside plugin root"));
        }

        let content = fs::read_to_string(&asset_path)
            .with_context(|| format!("Failed to read asset file from {}", asset_path.display()))?;
        info!(
            "[Plugins] Loaded {field_name} from: {}",
            asset_path.display()
        );
        Ok(content)
    }
}

fn should_scan_plugin_dir(name: &OsStr) -> bool {
    let name = name.to_string_lossy();
    !name.starts_with('.') && !name.starts_with("tmp-")
}

#[cfg(test)]
mod scanner_tests {
    use super::should_scan_plugin_dir;
    use std::ffi::OsStr;

    #[test]
    fn ignores_hidden_and_temporary_plugin_directories() {
        assert!(!should_scan_plugin_dir(OsStr::new(".plugin-rollback-123")));
        assert!(!should_scan_plugin_dir(OsStr::new("tmp-extract-123")));
        assert!(should_scan_plugin_dir(OsStr::new("dev.example.tool")));
    }
}
