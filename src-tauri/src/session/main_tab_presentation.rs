//! Bounded display metadata only; resource identity and lifecycle remain session-owned.
use super::{TabSnapshot, UNSUPPORTED_VERSION};
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

pub(super) const BACKUP_NAME: &str = "session.pre-main-tab-presentation-v2.json";
const VERSION: f64 = 2.0;
// The renderer and native boundary accept exactly the same built-in icon IDs.
static ICONS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    let catalog: Map<String, Value> = serde_json::from_str(include_str!(
        "../../../src/features/workspace/domain/mainTabIcons.json"
    ))
    .expect("bundled main tab icon catalog must be valid JSON");
    catalog.into_iter().map(|(key, _)| key).collect()
});

fn unsupported() -> String {
    format!("{UNSUPPORTED_VERSION}: unsupported main tab presentation metadata. Session saving is disabled to preserve the existing file.")
}

/// Normalize v1 pins or v2 decoration without dropping unknown fields. Empty metadata
/// inherits defaults. The numeric check matches JavaScript's JSON number semantics.
fn normalize(raw: &Value) -> Result<Option<Value>, String> {
    let object = raw.as_object().ok_or_else(unsupported)?;
    let version = object.get("version").and_then(Value::as_f64);
    let legacy = version == Some(1.0);
    if (!legacy && version != Some(VERSION))
        || object.keys().any(|key| {
            !matches!(key.as_str(), "version" | "pinned")
                && (legacy || !matches!(key.as_str(), "icon" | "accent" | "closeButton"))
        })
        || object.get("pinned").is_some_and(|pin| !pin.is_boolean())
        || object
            .get("icon")
            .is_some_and(|icon| !icon.as_str().is_some_and(|icon| ICONS.contains(icon)))
        || object.get("accent").is_some_and(|color| {
            !color.as_str().is_some_and(|color| {
                color.len() == 7
                    && color.starts_with('#')
                    && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
            })
        })
        || object
            .get("closeButton")
            .is_some_and(|mode| !matches!(mode.as_str(), Some("always" | "active" | "hidden")))
    {
        return Err(unsupported());
    }
    let mut normalized = Map::new();
    if object.get("pinned").and_then(Value::as_bool) == Some(true) {
        normalized.insert("pinned".into(), Value::Bool(true));
    }
    for key in ["icon", "closeButton"] {
        if let Some(value) = object.get(key) {
            normalized.insert(key.into(), value.clone());
        }
    }
    if let Some(color) = object.get("accent").and_then(Value::as_str) {
        normalized.insert("accent".into(), Value::String(color.to_ascii_lowercase()));
    }
    if normalized.is_empty() {
        return Ok(None);
    }
    normalized.insert("version".into(), Value::from(2));
    Ok(Some(Value::Object(normalized)))
}

/// Validate raw envelopes before serde/filtering can hide unsupported tab metadata.
pub(super) fn ensure_supported(raw: Option<&Value>) -> Result<(), String> {
    raw.map(normalize).transpose().map(|_| ())
}

pub(super) fn is_pinned(tab: &TabSnapshot) -> bool {
    tab.presentation
        .as_ref()
        .and_then(|value| value.get("pinned"))
        .and_then(Value::as_bool)
        == Some(true)
}

/// Migrate known metadata and stably partition pins, preserving unpinned decoration.
pub(super) fn normalize_tabs(tabs: &mut [TabSnapshot]) -> Result<(), String> {
    for tab in tabs.iter_mut() {
        tab.presentation = tab
            .presentation
            .as_ref()
            .map(normalize)
            .transpose()?
            .flatten();
    }
    tabs.sort_by_key(|tab| !is_pinned(tab));
    Ok(())
}

/// Check original JSON, not a decoded snapshot: decoding already migrates v1 to v2.
/// A separate recovery filename never replaces the earlier pin-only recovery copy.
pub(super) fn needs_backup(original: &str, next: &[TabSnapshot]) -> Result<bool, String> {
    if !next.iter().any(|tab| tab.presentation.is_some()) {
        return Ok(false);
    }
    let raw: Value = serde_json::from_str(original).map_err(|_| unsupported())?;
    let already_current = raw
        .get("tabs")
        .and_then(Value::as_array)
        .is_some_and(|tabs| {
            tabs.iter().any(|tab| {
                tab.get("presentation")
                    .and_then(|value| value.get("version"))
                    .and_then(Value::as_f64)
                    == Some(VERSION)
            })
        });
    Ok(!already_current)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_and_native_share_contract_cases() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/mainTabPresentation.json"
        ))
        .unwrap();
        for case in cases {
            let parsed = normalize(&case["value"]);
            assert_eq!(
                parsed.is_ok(),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
            if let Some(expected) = case.get("normalized") {
                assert_eq!(
                    parsed.unwrap().unwrap_or(Value::Null),
                    *expected,
                    "{}",
                    case["name"]
                );
            }
        }
        for icon in ICONS.iter() {
            assert!(normalize(&serde_json::json!({"version":2,"icon":icon})).is_ok());
        }
    }
}
