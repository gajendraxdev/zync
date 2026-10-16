use super::super::{Manifest, Plugin};
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct BuiltinIconTheme {
    path: String,
    manifest: Manifest,
}

fn catalog() -> &'static [BuiltinIconTheme] {
    static THEMES: OnceLock<Vec<BuiltinIconTheme>> = OnceLock::new();
    THEMES.get_or_init(|| {
        serde_json::from_str(include_str!(
            "../../../../plugin-api/builtin-icon-themes.json"
        ))
        .expect("Built-in icon catalog must be valid")
    })
}

/// Reserve catalog identities without reparsing manifests or constructing plugin instances.
pub(crate) fn is_builtin_icon_theme(id: &str) -> bool {
    catalog().iter().any(|theme| theme.manifest.id == id)
}

/// Built-in icon packs enter the same scanner, enabled-state and management pipeline as other plugins.
pub(crate) fn builtin_icon_themes() -> Vec<Plugin> {
    catalog()
        .iter()
        .map(|theme| Plugin {
            path: theme.path.clone(),
            manifest: theme.manifest.clone(),
            script: None,
            style: None,
            editor_html: None,
            enabled: true,
        })
        .collect()
}
