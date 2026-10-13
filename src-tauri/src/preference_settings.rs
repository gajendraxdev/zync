//! Shared compare-and-save policy for host-owned, versioned preference envelopes.
//! Callers fix the key and codec; this module exposes no dynamic IPC write authority.
use serde_json::Value;

/// Keep retired preference data opaque. Unrelated patches and exact echoes are
/// accepted; replacements (including deletion via null) are rejected before I/O.
/// The key is fixed by the native caller, never supplied through command input.
pub(crate) fn validate_preserved_patch(current: &Value, patch: &Value, key: &str) -> Result<(), String> {
    if patch.get(key).is_some_and(|next| current.get(key) != Some(next)) {
        return Err("Retired preferences are preserved and cannot be changed here.".into());
    }
    Ok(())
}

pub(crate) struct Policy {
    pub key: &'static str,
    pub supported: fn(&Value) -> bool,
    /// Called only after both inputs pass the bounded codec.
    pub equivalent: fn(&Value, &Value) -> bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn retired_preferences_preserve_absent_and_opaque_values() {
        let key = "workspaceLayoutPresets";
        for retained in [json!({"version": 99, "opaque": [null, "keep"]}), json!(null), json!("unknown")] {
            let current = json!({"theme": "dark", "workspaceLayoutPresets": retained});
            assert!(validate_preserved_patch(&current, &json!({"theme": "light"}), key).is_ok());
            assert!(validate_preserved_patch(&current, &current, key).is_ok());
            assert!(validate_preserved_patch(&current, &json!({"workspaceLayoutPresets": {"version": 1, "presets": []}}), key).is_err());
        }
        let absent = json!({"theme": "dark"});
        assert!(validate_preserved_patch(&absent, &json!({"theme": "light"}), key).is_ok());
        assert!(validate_preserved_patch(&absent, &json!({"workspaceLayoutPresets": null}), key).is_err());
        let current = json!({"workspaceLayoutPresets": {"version": 99}});
        assert!(validate_preserved_patch(&current, &json!({"workspaceLayoutPresets": null}), key).is_err());
        assert_eq!(current[key]["version"], 99);
    }
}

impl Policy {
    /// Preserve unrelated patches and exact opaque data; edits use compare-and-save.
    pub fn validate_managed_patch(&self, current: &Value, patch: &Value) -> Result<(), String> {
        if patch.get(self.key).is_some_and(|next| {
            !current.get(self.key).is_some_and(|old| {
                old == next
                    || ((self.supported)(old)
                        && (self.supported)(next)
                        && (self.equivalent)(old, next))
            })
        }) {
            return Err("Use the customization editor to change these preferences, or edit settings.json explicitly.".into());
        }
        Ok(())
    }

    /// Run under the existing settings lock, before backups/writes. An identical retry
    /// after a lost acknowledgement succeeds without writing or replacing the backup.
    pub fn replacement(
        &self,
        current: &Value,
        expected: &Value,
        next: &Value,
    ) -> Result<Option<Value>, String> {
        let Some(settings) = current.as_object() else {
            return Err("Settings must be an object.".into());
        };
        let old = settings.get(self.key);
        if !(self.supported)(next) || old.is_some_and(|old| !(self.supported)(old)) {
            return Err("These customization settings use an unsupported format. Reload and review settings.json before changing them.".into());
        }
        let valid_expected = expected.as_object().is_some_and(|object| {
            (object.len() == 1 && expected["exists"] == false)
                || (object.len() == 2
                    && expected["exists"] == true
                    && (self.supported)(&expected["value"]))
        });
        if !valid_expected {
            return Err("Invalid preference comparison. Reload settings and retry.".into());
        }
        if old.is_some_and(|old| (self.equivalent)(old, next)) {
            return Ok(None);
        }
        let matches = if expected["exists"] == false {
            old.is_none()
        } else {
            old.is_some_and(|old| (self.equivalent)(old, &expected["value"]))
        };
        if !matches {
            return Err(
                "These preferences changed since they were loaded. Reload settings and retry."
                    .into(),
            );
        }
        let mut result = settings.clone();
        result.insert(self.key.into(), next.clone());
        Ok(Some(Value::Object(result)))
    }
}
