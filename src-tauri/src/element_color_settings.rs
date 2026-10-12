//! Finite semantic colors only: no selectors, asset paths, CSS expressions or scripts.
use crate::preference_settings::Policy;
use serde_json::{Map, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

pub(crate) const KEY: &str = "elementColors";
const POLICY: Policy = Policy {
    key: KEY,
    supported,
    equivalent,
};
// Build-time source shared with the renderer. A changed catalog cannot silently
// accept a different key set in the native writer.
static KEYS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    let catalog: Map<String, Value> = serde_json::from_str(include_str!(
        "../../src/features/appearance/domain/elementColorCatalog.json"
    ))
    .expect("bundled element color catalog must be valid JSON");
    catalog.into_iter().map(|(key, _)| key).collect()
});

/// Canonicalize only known v1 envelopes. Unknown fields/versions are preserved raw,
/// not downgraded or partially applied by a managed edit.
pub(crate) fn normalize(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    if object.len() != 2 || value["version"].as_f64() != Some(1.0) {
        return None;
    }
    let input = object.get("overrides")?.as_object()?;
    if input.len() > KEYS.len() {
        return None;
    }
    let mut overrides = Map::new();
    for (key, value) in input {
        let color = value.as_str()?;
        if !KEYS.contains(key)
            || color.len() != 7
            || !color.starts_with('#')
            || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        {
            return None;
        }
        overrides.insert(key.clone(), Value::String(color.to_ascii_lowercase()));
    }
    Some(serde_json::json!({"version":1,"overrides":overrides}))
}

fn supported(value: &Value) -> bool {
    normalize(value).is_some()
}
fn equivalent(left: &Value, right: &Value) -> bool {
    normalize(left) == normalize(right)
}

pub(crate) fn validate_managed_patch(current: &Value, patch: &Value) -> Result<(), String> {
    POLICY.validate_managed_patch(current, patch)
}

pub(crate) fn replacement(
    current: &Value,
    expected: &Value,
    next: &Value,
) -> Result<Option<Value>, String> {
    POLICY.replacement(current, expected, next)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn colors() -> Value {
        json!({"version":1,"overrides":{"mainTabs.background":"#ABC123"}})
    }

    #[test]
    fn shared_renderer_native_cases_and_key_catalog() {
        let cases: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/elementColors.json")).unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(
                supported(&case["value"]),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
        assert_eq!(KEYS.len(), 33);
        for key in KEYS.iter() {
            assert!(supported(&json!({"version":1,"overrides":{key:"#123456"}})));
        }
    }

    #[test]
    fn compare_save_preserves_other_fields_and_accepts_equivalent_retries() {
        let initial = json!({"theme":"dark","workspaceLayoutPresets":{"version":99}});
        let saved = replacement(&initial, &json!({"exists":false}), &colors())
            .unwrap()
            .unwrap();
        assert_eq!(saved["theme"], initial["theme"]);
        assert_eq!(
            saved["workspaceLayoutPresets"],
            initial["workspaceLayoutPresets"]
        );
        let equivalent = json!({"version":1.0,"overrides":{"mainTabs.background":"#abc123"}});
        assert!(replacement(&saved, &json!({"exists":false}), &equivalent)
            .unwrap()
            .is_none());
        let reset = json!({"version":1,"overrides":{}});
        assert!(replacement(&saved, &json!({"exists":false}), &reset).is_err());
        assert!(
            replacement(&saved, &json!({"exists":true,"value":equivalent}), &reset)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn protects_unsupported_and_rejects_generic_mutations() {
        for value in [
            Value::Null,
            json!({"version":99,"overrides":{}}),
            json!({"version":1,"overrides":{"unknown":"#123456"}}),
        ] {
            let current = json!({KEY:value});
            assert!(replacement(&current, &json!({"exists":false}), &colors()).is_err());
            assert!(validate_managed_patch(&current, &json!({"theme":"light"})).is_ok());
            assert!(validate_managed_patch(&current, &current).is_ok());
            assert!(validate_managed_patch(&current, &json!({KEY:colors()})).is_err());
        }
        assert!(validate_managed_patch(&json!({}), &json!({KEY:colors()})).is_err());
    }

    #[test]
    fn rejects_forged_comparisons_even_for_identical_values() {
        for expected in [
            Value::Null,
            json!({}),
            json!({"exists":true}),
            json!({"exists":false,"value":null}),
            json!({"exists":true,"value":colors(),"other":true}),
        ] {
            assert!(replacement(&json!({KEY:colors()}), &expected, &colors()).is_err());
        }
        assert!(replacement(&Value::Null, &json!({"exists":false}), &colors()).is_err());
    }
}
