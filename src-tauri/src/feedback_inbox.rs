//! Dedicated installation-local inbox credentials. Secrets never enter the
//! renderer, analytics identifiers, settings persistence, or plugin APIs.

use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub(crate) mod transport;
pub use transport::TransportState;

const SERVICE: &str = "com.zync.feedback-inbox";
const ACCOUNT: &str = "installation-v1";
// Only pre-request keyring failures carry this code. An accepted submission
// whose enrollment write fails must never be retried through the legacy API.
const STORAGE_ERROR_CODE: &str = "INBOX_CREDENTIAL_STORAGE_UNAVAILABLE";
static CREDENTIAL_LOCK: Mutex<()> = Mutex::new(());

fn storage_error(message: &str) -> String {
    format!("{STORAGE_ERROR_CODE}: {message}")
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Credential {
    id: String,
    token: String,
    #[serde(default)]
    registered: bool,
}

impl Credential {
    /// Reject damaged records instead of silently rotating and losing old replies.
    fn parse(raw: &str) -> Result<Self, String> {
        let value: Self = serde_json::from_str(raw)
            .map_err(|_| "Feedback inbox credential is damaged".to_string())?;
        let id = uuid::Uuid::parse_str(&value.id)
            .map_err(|_| "Feedback inbox identity is invalid".to_string())?;
        if id.is_nil()
            || id.to_string() != value.id
            || value.token.len() != 64
            || !value.token.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err("Feedback inbox credential is invalid".into());
        }
        Ok(value)
    }

    fn generate() -> Result<Self, String> {
        let mut bytes = [0u8; 32];
        OsRng
            .try_fill_bytes(&mut bytes)
            .map_err(|_| "Secure randomness is unavailable".to_string())?;
        let token = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        Ok(Self {
            id: uuid::Uuid::new_v4().to_string(),
            token,
            registered: false,
        })
    }
}

/// Reading does not create credentials. Creation must be explicitly requested
/// after inbox opt-in. Keyring failure never falls back to plaintext or a new key.
fn credential(create: bool) -> Result<Option<Credential>, String> {
    let _guard = CREDENTIAL_LOCK
        .lock()
        .map_err(|_| storage_error("Feedback inbox is unavailable"))?;
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|_| storage_error("Feedback inbox credential storage is unavailable"))?;
    match entry.get_password() {
        Ok(raw) => Ok(Some(Credential::parse(&raw)?)),
        Err(keyring::Error::NoEntry) if !create => Ok(None),
        Err(keyring::Error::NoEntry) => {
            let credential = Credential::generate()?;
            let raw = serde_json::to_string(&credential)
                .map_err(|_| "Could not encode feedback inbox credentials")?;
            entry.set_password(&raw).map_err(|_| {
                storage_error("Could not securely store feedback inbox credentials")
            })?;
            Ok(Some(credential))
        }
        Err(_) => Err(storage_error(
            "Could not read feedback inbox credential storage",
        )),
    }
}

/// Expose only the public routing ID to the trusted main window. Blocking OS
/// credential operations run off the UI thread; raw secrets remain native-owned.
#[tauri::command]
pub async fn feedback_inbox_identity(
    window: tauri::WebviewWindow,
    create: bool,
) -> Result<Option<String>, String> {
    if window.label() != "main" {
        return Err("Feedback inbox is available only in the main app window".into());
    }
    if create && !transport::enabled() {
        return Err("Feedback inbox is not enabled in this build".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        credential(create).map(|value| value.map(|item| item.id))
    })
    .await
    .map_err(|_| "Feedback inbox credential task failed".to_string())?
}

/// Mark enrollment only after authenticated server confirmation (submission or
/// recovery snapshot after a lost acknowledgement).
/// Preserve the exact identity on retry; never replace a missing/corrupt record.
fn mark_registered(id: &str) -> Result<(), String> {
    let _guard = CREDENTIAL_LOCK
        .lock()
        .map_err(|_| "Inbox credential storage unavailable")?;
    let entry = keyring::Entry::new(SERVICE, ACCOUNT)
        .map_err(|_| "Inbox credential storage unavailable")?;
    let raw = entry
        .get_password()
        .map_err(|_| "Could not confirm inbox enrollment in secure storage")?;
    let mut value = Credential::parse(&raw)?;
    if value.id != id {
        return Err("Inbox identity changed during submission".into());
    }
    value.registered = true;
    entry.set_password(&serde_json::to_string(&value).map_err(|_| "Could not encode inbox enrollment")?)
        .map_err(|_| "Feedback accepted, but secure enrollment could not be saved. Retry with the same submission.".to_string())
}

#[cfg(test)]
mod tests {
    use super::Credential;

    #[test]
    fn credentials_roundtrip_without_exposing_tokens_in_errors() {
        let generated = Credential::generate().unwrap();
        let encoded = serde_json::to_string(&generated).unwrap();
        let restored = Credential::parse(&encoded).unwrap();
        assert_eq!(restored.id, generated.id);
        assert_eq!(restored.token, generated.token);
    }

    #[test]
    fn malformed_credentials_are_not_replaced() {
        for value in ["{}", "null", "not json", r#"{"id":"bad","token":"secret"}"#] {
            assert!(Credential::parse(value).is_err());
        }
    }
}
