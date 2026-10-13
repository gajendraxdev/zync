use serde_json::Value;

pub(super) const BACKUP_NAME: &str = "session.pre-workspace-docking-v1.json";

/// Validate the same bounded envelope as the renderer before serde or a save can
/// discard unsupported placement data. This metadata never authorizes resources.
pub(super) fn ensure_supported(raw: Option<&Value>) -> Result<(), String> {
    let Some(raw) = raw else { return Ok(()) };
    let unsupported = || {
        format!("{}: unsupported workspace docking metadata. Session saving is disabled to preserve the existing file.", super::UNSUPPORTED_VERSION)
    };
    let scopes = raw.as_object().ok_or_else(unsupported)?;
    if scopes.len() > super::MAX_PRESENTATION_SCOPES {
        return Err(unsupported());
    }
    for (id, scope) in scopes {
        if id.trim().is_empty() || id.encode_utf16().count() > 256 {
            return Err(unsupported());
        }
        let scope = scope.as_object().ok_or_else(unsupported)?;
        if scope.get("version").and_then(Value::as_u64) != Some(1)
            || scope
                .keys()
                .any(|key| key != "version" && key != "placements" && key != "sizes")
        {
            return Err(unsupported());
        }
        let placements = scope
            .get("placements")
            .and_then(Value::as_object)
            .ok_or_else(unsupported)?;
        if placements.len() > super::MAX_PRESENTATION_ITEMS_PER_SCOPE {
            return Err(unsupported());
        }
        for (key, region) in placements {
            if !super::is_presentation_key(key)
                || !matches!(
                    region.as_str(),
                    Some("primary-sidebar" | "secondary-sidebar" | "bottom-panel")
                )
            {
                return Err(unsupported());
            }
        }
        if let Some(sizes) = scope.get("sizes") {
            let sizes = sizes.as_object().ok_or_else(unsupported)?;
            if sizes.len() != 3
                || sizes
                    .keys()
                    .any(|key| !matches!(key.as_str(), "primary" | "secondary" | "bottom"))
            {
                return Err(unsupported());
            }
            for (name, min, max) in [
                ("primary", 0.15, 0.35),
                ("secondary", 0.15, 0.35),
                ("bottom", 0.2, 0.5),
            ] {
                if !sizes
                    .get(name)
                    .and_then(Value::as_f64)
                    .is_some_and(|number| number.is_finite() && number >= min && number <= max)
                {
                    return Err(unsupported());
                }
            }
        }
    }
    Ok(())
}

/// An existing snapshot gets a separate recovery copy before its first docking
/// envelope. The original is preserved even when placements reference absent views.
pub(super) fn needs_backup(previous: Option<&Value>, next: Option<&Value>) -> bool {
    let populated = |value: Option<&Value>| {
        value
            .and_then(Value::as_object)
            .is_some_and(|map| !map.is_empty())
    };
    populated(next) && !populated(previous)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn known_docking_envelopes_and_size_boundaries_are_supported() {
        assert!(ensure_supported(None).is_ok());
        for sizes in [
            json!({"primary":0.15,"secondary":0.15,"bottom":0.2}),
            json!({"primary":0.35,"secondary":0.35,"bottom":0.5}),
        ] {
            let key = serde_json::to_string(&["term", "日本語 😄"]).unwrap();
            let value =
                json!({"local":{"version":1,"placements":{key:"bottom-panel"},"sizes":sizes}});
            assert!(ensure_supported(Some(&value)).is_ok());
        }
    }

    #[test]
    fn future_partial_and_malformed_docking_is_rejected_before_parsing() {
        for value in [
            Value::Null,
            json!([]),
            json!({"local":null}),
            json!({"local":{"version":2,"placements":{}}}),
            json!({"local":{"version":1,"placements":{},"unknown":true}}),
            json!({"local":{"version":1}}),
            json!({"local":{"version":1,"placements":{"[\"term\",\"a\"]":"workspace"}}}),
            json!({"local":{"version":1,"placements":{"invalid":"bottom-panel"}}}),
            json!({"local":{"version":1,"placements":{},"sizes":null}}),
            json!({"local":{"version":1,"placements":{},"sizes":{"primary":0.24}}}),
            json!({"local":{"version":1,"placements":{},"sizes":{"primary":0.24,"secondary":0.24,"bottom":0.6}}}),
            json!({" ":{"version":1,"placements":{}}}),
        ] {
            assert!(ensure_supported(Some(&value)).is_err(), "{value}");
        }
    }

    #[test]
    fn docking_metadata_budgets_and_first_use_are_bounded() {
        let scope = json!({"version":1,"placements":{}});
        let oversized: serde_json::Map<String, Value> = (0..257)
            .map(|index| (format!("scope-{index}"), scope.clone()))
            .collect();
        assert!(ensure_supported(Some(&Value::Object(oversized))).is_err());
        let placements: serde_json::Map<String, Value> = (0..257)
            .map(|index| {
                (
                    serde_json::to_string(&["term", &index.to_string()]).unwrap(),
                    json!("bottom-panel"),
                )
            })
            .collect();
        assert!(ensure_supported(Some(
            &json!({"local":{"version":1,"placements":placements}})
        ))
        .is_err());
        let current = json!({"local":scope});
        assert!(needs_backup(None, Some(&current)));
        assert!(!needs_backup(Some(&current), Some(&current)));
        assert!(!needs_backup(None, Some(&json!({}))));
    }
}
