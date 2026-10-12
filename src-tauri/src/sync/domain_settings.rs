#![allow(dead_code)]

use super::profiles::now_secs;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSyncRecord {
    pub logical_id: String,
    pub payload: serde_json::Value,
    pub updated_at: u64,
}

pub const SETTINGS_ALLOWLIST_KEYS: &[&str] = &[
    "theme",
    "fontFamily",
    "fontSize",
    "showHiddenFiles",
    "confirmOnExit",
    "editorTheme",
    "terminalFontSize",
];

/// Shared upload/restore boundary. Imported themes are device-local until their
/// validated document has a sync contract; never transfer a dangling selector,
/// including from records uploaded by older clients.
pub(super) fn project_syncable_settings(
    settings: &serde_json::Value,
) -> serde_json::Map<String, serde_json::Value> {
    SETTINGS_ALLOWLIST_KEYS
        .iter()
        .filter_map(|key| {
            let value = settings.as_object()?.get(*key)?;
            if *key == "theme" && value.as_str() == Some("custom") {
                return None;
            }
            Some(((*key).to_owned(), value.clone()))
        })
        .collect()
}

pub async fn load_allowlisted_settings(
    app: &tauri::AppHandle,
    previous: Option<&SettingsSyncRecord>,
) -> Result<SettingsSyncRecord, String> {
    let settings: serde_json::Value = crate::commands::settings_get(app.clone()).await?;
    settings.as_object().ok_or_else(|| {
        "[sync_settings_invalid] settings_get returned non-object JSON".to_string()
    })?;
    let payload = serde_json::Value::Object(project_syncable_settings(&settings));
    let updated_at = previous
        .filter(|record| record.payload == payload)
        .map(|record| record.updated_at)
        .unwrap_or_else(now_secs);
    Ok(SettingsSyncRecord {
        logical_id: "app-settings-default".to_string(),
        payload,
        updated_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn custom_theme_selector_and_local_payload_never_leave_the_device() {
        let projected = project_syncable_settings(&json!({
            "theme":"custom", "customTheme":{"palette":{"accent":"#123456"}},
            "elementColors":{"version":1,"overrides":{}}, "fontSize":16
        }));
        assert_eq!(serde_json::Value::Object(projected), json!({"fontSize":16}));
    }

    #[test]
    fn old_custom_records_preserve_the_receiving_theme_and_other_local_preferences() {
        for theme in ["dark", "custom"] {
            let mut local = json!({"theme":theme,"customTheme":{"name":"Local"},"fontSize":12});
            local
                .as_object_mut()
                .unwrap()
                .extend(project_syncable_settings(
                    &json!({"theme":"custom","fontSize":16}),
                ));
            assert_eq!(
                local,
                json!({"theme":theme,"customTheme":{"name":"Local"},"fontSize":16})
            );
        }
    }

    #[test]
    fn ordinary_theme_selection_and_allowlisted_values_still_sync() {
        for theme in ["dark", "light", "com.zync.theme.example"] {
            assert_eq!(
                serde_json::Value::Object(project_syncable_settings(
                    &json!({"theme":theme,"fontSize":14,"private":"ignored"})
                )),
                json!({"theme":theme,"fontSize":14})
            );
        }
        assert!(project_syncable_settings(&serde_json::Value::Null).is_empty());
    }
}
