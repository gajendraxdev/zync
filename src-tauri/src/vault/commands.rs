use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;
use tokio::sync::Mutex;
use zeroize::Zeroize;
use base64::Engine;

use crate::vault::error::VaultError;
use crate::vault::migration::{MigrationPreview, MigrationResult};
use crate::vault::store::VaultService;
use crate::vault::types::{PlaintextRecord, VaultItemMeta, VaultStatus};

// ── Error wrapper (serializable for IPC) ─────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct VaultCommandError {
    pub code: String,
    pub message: String,
}

impl From<VaultError> for VaultCommandError {
    fn from(e: VaultError) -> Self {
        let (code, message) = match &e {
            VaultError::NotInitialized => ("not_initialized", e.to_string()),
            VaultError::AlreadyInitialized => ("already_initialized", e.to_string()),
            VaultError::Locked => ("locked", e.to_string()),
            VaultError::WrongPassphrase => ("wrong_passphrase", e.to_string()),
            VaultError::RecordNotFound(_) => ("not_found", e.to_string()),
            _ => ("error", e.to_string()),
        };
        Self {
            code: code.to_string(),
            message,
        }
    }
}

type VaultResult<T> = Result<T, VaultCommandError>;

// ── Commands ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_status(vault: State<'_, Mutex<VaultService>>) -> VaultResult<VaultStatus> {
    vault.lock().await.status().map_err(Into::into)
}

#[derive(Deserialize)]
pub struct InitializeArgs {
    pub passphrase: SecretString,
}

#[tauri::command]
pub async fn vault_initialize(
    vault: State<'_, Mutex<VaultService>>,
    args: InitializeArgs,
) -> VaultResult<VaultStatus> {
    vault
        .lock()
        .await
        .initialize(args.passphrase.expose_secret())
        .map_err(Into::into)
}

#[derive(Deserialize)]
pub struct UnlockArgs {
    pub passphrase: SecretString,
}

#[tauri::command]
pub async fn vault_unlock(
    vault: State<'_, Mutex<VaultService>>,
    args: UnlockArgs,
) -> VaultResult<VaultStatus> {
    vault
        .lock()
        .await
        .unlock(args.passphrase.expose_secret())
        .map_err(Into::into)
}

#[tauri::command]
pub async fn vault_lock(vault: State<'_, Mutex<VaultService>>) -> VaultResult<()> {
    vault.lock().await.lock();
    Ok(())
}

#[derive(Deserialize)]
pub struct ItemCreateArgs {
    pub label: String,
    pub kind: String,
    pub secret: SecretString,
    pub notes: Option<String>,
}

impl Drop for ItemCreateArgs {
    fn drop(&mut self) {
        if let Some(notes) = &mut self.notes {
            notes.zeroize();
        }
    }
}

#[tauri::command]
pub async fn vault_item_create(
    vault: State<'_, Mutex<VaultService>>,
    args: ItemCreateArgs,
) -> VaultResult<VaultItemMeta> {
    let record = vault
        .lock()
        .await
        .item_create(
            &args.label,
            &args.kind,
            args.secret.expose_secret(),
            args.notes.as_deref(),
        )
        .map_err(VaultCommandError::from)?;
    Ok(item_meta_from_plaintext(record))
}

#[tauri::command]
pub async fn vault_item_list(
    vault: State<'_, Mutex<VaultService>>,
) -> VaultResult<Vec<VaultItemMeta>> {
    let items = vault.lock().await.item_list().map_err(VaultCommandError::from)?;
    Ok(items.into_iter().map(item_meta_from_plaintext).collect())
}

#[derive(Deserialize)]
pub struct ItemGetArgs {
    pub item_id: String,
}

#[tauri::command]
pub async fn vault_item_get(
    vault: State<'_, Mutex<VaultService>>,
    args: ItemGetArgs,
) -> VaultResult<PlaintextRecord> {
    vault
        .lock()
        .await
        .item_get(&args.item_id)
        .map_err(Into::into)
}

fn item_meta_from_plaintext(record: PlaintextRecord) -> VaultItemMeta {
    VaultItemMeta {
        id: record.id.clone(),
        kind: record.kind.clone(),
        label: record.label.clone(),
        secret_fingerprint: secret_fingerprint(&record.secret),
        revision: record.revision,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

fn secret_fingerprint(secret: &str) -> String {
    let digest = Sha256::digest(secret.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest)
}

#[derive(Deserialize)]
pub struct ItemDeleteArgs {
    pub item_id: String,
}

#[tauri::command]
pub async fn vault_item_delete(
    vault: State<'_, Mutex<VaultService>>,
    args: ItemDeleteArgs,
) -> VaultResult<()> {
    vault
        .lock()
        .await
        .item_delete(&args.item_id)
        .map_err(Into::into)
}

// ── Recovery key commands ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_generate_recovery_key(
    vault: State<'_, Mutex<VaultService>>,
) -> VaultResult<String> {
    vault
        .lock()
        .await
        .generate_recovery_key()
        .map_err(Into::into)
}

#[tauri::command]
pub async fn vault_has_recovery_key(vault: State<'_, Mutex<VaultService>>) -> VaultResult<bool> {
    vault.lock().await.has_recovery_key().map_err(Into::into)
}

#[derive(Deserialize)]
pub struct UnlockWithRecoveryKeyArgs {
    pub recovery_key: SecretString,
}

#[tauri::command]
pub async fn vault_unlock_with_recovery_key(
    vault: State<'_, Mutex<VaultService>>,
    args: UnlockWithRecoveryKeyArgs,
) -> VaultResult<VaultStatus> {
    vault
        .lock()
        .await
        .unlock_with_recovery_key(args.recovery_key.expose_secret())
        .map_err(Into::into)
}

// ── Export / Import commands ──────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ExportArgs {
    pub dest_path: String,
}

#[tauri::command]
pub async fn vault_export(
    vault: State<'_, Mutex<VaultService>>,
    args: ExportArgs,
) -> VaultResult<()> {
    let dest_path = validate_export_path(&args.dest_path)?;
    vault
        .lock()
        .await
        .export_vault(&dest_path)
        .map_err(Into::into)
}

#[derive(Deserialize)]
pub struct ImportArgs {
    pub src_path: String,
}

#[tauri::command]
pub async fn vault_import(
    vault: State<'_, Mutex<VaultService>>,
    args: ImportArgs,
) -> VaultResult<VaultStatus> {
    let src_path = validate_import_path(&args.src_path)?;
    vault
        .lock()
        .await
        .import_vault(&src_path)
        .map_err(Into::into)
}

// ── Migration commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn vault_migration_preview(app: tauri::AppHandle) -> VaultResult<MigrationPreview> {
    let data_dir = crate::commands::get_data_dir(&app);
    crate::vault::migration::preview(&data_dir).map_err(Into::into)
}

#[tauri::command]
pub async fn vault_migrate_existing_secrets(
    app: tauri::AppHandle,
    vault: State<'_, Mutex<VaultService>>,
) -> VaultResult<MigrationResult> {
    let data_dir = crate::commands::get_data_dir(&app);
    let guard = vault.lock().await;
    crate::vault::migration::migrate(&data_dir, &guard).map_err(Into::into)
}

fn validate_export_path(path: &str) -> VaultResult<std::path::PathBuf> {
    let path = std::path::PathBuf::from(path);
    let parent = path.parent().ok_or_else(|| VaultCommandError {
        code: "invalid_path".into(),
        message: "Export path must have a parent directory".into(),
    })?;
    let canonical_parent = std::fs::canonicalize(parent).map_err(|e| VaultCommandError {
        code: "invalid_path".into(),
        message: format!("Export parent does not exist or is not accessible: {e}"),
    })?;
    let file_name = path.file_name().ok_or_else(|| VaultCommandError {
        code: "invalid_path".into(),
        message: "Export path must include a file name".into(),
    })?;
    Ok(canonical_parent.join(file_name))
}

fn validate_import_path(path: &str) -> VaultResult<std::path::PathBuf> {
    std::fs::canonicalize(path).map_err(|e| VaultCommandError {
        code: "invalid_path".into(),
        message: format!("Import file does not exist or is not accessible: {e}"),
    })
}
