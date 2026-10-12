//! Bounded host chrome preferences; cannot hide mandatory status indicators or execute actions.
use crate::preference_settings::Policy;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::sync::LazyLock;

pub(crate) const KEY: &str = "chromeActions";
const POLICY: Policy = Policy {
    key: KEY,
    supported,
    equivalent,
};
static CATALOG: LazyLock<Map<String, Value>> = LazyLock::new(|| {
    serde_json::from_str(include_str!(
        "../../src/features/workspace/domain/chromeActionCatalog.json"
    ))
    .expect("bundled chrome action catalog must be valid JSON")
});

/// Share canonical order with the renderer, independent of JSON map iteration order.
fn normalize(value: &Value) -> Option<Value> {
    let object = value.as_object()?;
    if object.len() != 3 || value["version"].as_f64() != Some(1.0) {
        return None;
    }
    let mut result = Map::new();
    result.insert("version".into(), json!(1));
    for area in ["workspaceToolbar", "statusBar"] {
        let input = object.get(area)?.as_object()?;
        if input.len() != 2 {
            return None;
        }
        let mut allowed: Vec<_> = CATALOG
            .iter()
            .filter(|(_, entry)| entry["area"] == area)
            .collect();
        allowed.sort_by_key(|(_, entry)| entry["position"].as_u64().expect("catalog position"));
        let validate = |key| -> Option<Vec<String>> {
            let array = input.get(key)?.as_array()?;
            if array.len() > allowed.len() {
                return None;
            }
            let mut seen = HashSet::new();
            let mut ids = Vec::new();
            for id in array {
                let id = id.as_str()?;
                if !allowed.iter().any(|(known, _)| known.as_str() == id) || !seen.insert(id) {
                    return None;
                }
                if key == "hidden" && CATALOG[id]["optional"] != true {
                    return None;
                }
                ids.push(id.to_owned());
            }
            Some(ids)
        };
        let mut order = validate("order")?;
        let hidden = validate("hidden")?;
        for (id, _) in allowed {
            if !order.contains(id) {
                order.push(id.clone());
            }
        }
        let hidden: Vec<_> = order
            .iter()
            .filter(|id| hidden.contains(id))
            .cloned()
            .collect();
        result.insert(area.into(), json!({"order":order,"hidden":hidden}));
    }
    Some(Value::Object(result))
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
    fn defaults() -> Value {
        json!({"version":1,"workspaceToolbar":{"order":[],"hidden":[]},"statusBar":{"order":[],"hidden":[]}})
    }

    #[test]
    fn shared_cases_and_defaults_match_renderer() {
        let cases: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/chromeActions.json")).unwrap();
        for case in cases.as_array().unwrap() {
            assert_eq!(
                supported(&case["value"]),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["name"]
            );
        }
        assert_eq!(
            normalize(&defaults()).unwrap()["workspaceToolbar"]["order"],
            json!([
                "terminal.find",
                "workspace.splits",
                "workspace.sessionTools"
            ])
        );
        assert_eq!(
            normalize(&defaults()).unwrap()["statusBar"]["order"][0],
            "status.editor"
        );
    }

    #[test]
    fn compare_save_preserves_other_data_and_supports_lost_ack_retry() {
        let current = json!({"theme":"dark","workspaceNavigation":{"version":99}});
        let saved = replacement(&current, &json!({"exists":false}), &defaults())
            .unwrap()
            .unwrap();
        assert_eq!(saved["theme"], current["theme"]);
        assert_eq!(saved["workspaceNavigation"], current["workspaceNavigation"]);
        assert!(replacement(
            &saved,
            &json!({"exists":false}),
            &normalize(&defaults()).unwrap()
        )
        .unwrap()
        .is_none());
        let mut hidden = defaults();
        hidden["statusBar"]["hidden"] = json!(["status.ai"]);
        assert!(replacement(&saved, &json!({"exists":false}), &hidden).is_err());
        assert!(
            replacement(&saved, &json!({"exists":true,"value":defaults()}), &hidden)
                .unwrap()
                .is_some()
        );
    }

    #[test]
    fn protects_unknown_data_mandatory_indicators_and_managed_writes() {
        for raw in [Value::Null, json!({"version":99}), json!({})] {
            let current = json!({KEY:raw});
            assert!(replacement(&current, &json!({"exists":false}), &defaults()).is_err());
            assert!(validate_managed_patch(&current, &current).is_ok());
            assert!(validate_managed_patch(&current, &json!({"theme":"light"})).is_ok());
            assert!(validate_managed_patch(&current, &json!({KEY:defaults()})).is_err());
        }
        for (id, entry) in CATALOG
            .iter()
            .filter(|(_, entry)| entry["optional"] == false)
        {
            let mut value = defaults();
            value[entry["area"].as_str().unwrap()]["hidden"] = json!([id]);
            assert!(!supported(&value));
        }
        assert!(validate_managed_patch(&json!({}), &json!({KEY:defaults()})).is_err());
        assert!(replacement(&json!({}), &json!({"exists":true}), &defaults()).is_err());
    }
}
