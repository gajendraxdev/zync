use std::collections::HashMap;
use std::path::Path;

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::types::{CredentialItemKind, CredentialPurpose, CredentialRef, SavedData};
use crate::vault::error::VaultError;
use crate::vault::store::VaultService;

// ── Preview ───────────────────────────────────────────────────────────────────

/// One connection that can be migrated.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationCandidate {
    pub connection_id: String,
    pub connection_name: String,
    pub host: String,
    pub migration_kind: MigrationKind,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum MigrationKind {
    SshPassword,
    SshPrivateKey,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationPreview {
    pub candidates: Vec<MigrationCandidate>,
    pub already_migrated: u32,
    /// Key files referenced in connections but not found on disk — cannot migrate.
    pub skipped_no_file: u32,
}

/// Read connections.json and return what would be migrated. Does not require vault unlock.
pub fn preview(data_dir: &Path) -> Result<MigrationPreview, VaultError> {
    let saved = load_connections(data_dir)?;

    let mut candidates = Vec::new();
    let mut already_migrated = 0u32;
    let mut skipped_no_file = 0u32;

    for conn in &saved.connections {
        if conn.auth_ref.is_some() {
            already_migrated += 1;
            continue;
        }
        if let Some(key_path) = &conn.private_key_path {
            if key_path.is_empty() {
                continue;
            }
            if !std::path::Path::new(key_path).exists() {
                skipped_no_file += 1;
                continue;
            }
            candidates.push(MigrationCandidate {
                connection_id: conn.id.clone(),
                connection_name: conn.name.clone(),
                host: conn.host.clone(),
                migration_kind: MigrationKind::SshPrivateKey,
            });
            continue;
        }
        if conn.password.is_some() {
            candidates.push(MigrationCandidate {
                connection_id: conn.id.clone(),
                connection_name: conn.name.clone(),
                host: conn.host.clone(),
                migration_kind: MigrationKind::SshPassword,
            });
        }
    }

    Ok(MigrationPreview {
        candidates,
        already_migrated,
        skipped_no_file,
    })
}

// ── Migrate ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub migrated: u32,
    pub skipped: u32,
    pub already_done: u32,
    pub backup_path: Option<String>,
}

/// Migrate all migratable connections to vault items and rewrite connections.json.
///
/// Handles password auth (ssh-password) and key file auth (ssh-private-key).
/// Key files are read and stored in vault; original files are left untouched.
/// A backup is written to `connections.json.pre-vault-migration` before any change.
pub fn migrate(data_dir: &Path, vault: &VaultService) -> Result<MigrationResult, VaultError> {
    let connections_path = data_dir.join("connections.json");
    let backup_path = data_dir.join("connections.json.pre-vault-migration");

    let mut saved = load_connections(data_dir)?;

    let mut skipped = 0u32;
    let mut already_done = 0u32;
    let vault_id = vault.vault_id().ok_or(VaultError::Locked)?;
    let mut prepared = Vec::new();

    for (index, conn) in saved.connections.iter().enumerate() {
        if conn.auth_ref.is_some() {
            already_done += 1;
            continue;
        }

        // ── Key-based auth ────────────────────────────────────────────────────
        if let Some(ref key_path) = conn.private_key_path {
            if key_path.is_empty() {
                skipped += 1;
                continue;
            }
            let key_content = match std::fs::read_to_string(key_path) {
                Ok(c) => c,
                Err(_) => {
                    skipped += 1;
                    continue;
                }
            };
            let label = format!("{} key ({}@{})", conn.name, conn.username, conn.host);
            prepared.push(PreparedMigration {
                index,
                label,
                kind: CredentialItemKind::SshPrivateKey,
                secret: serde_json::json!({
                    "key": key_content,
                    "passphrase": conn.password.as_ref(),
                })
                .to_string(),
            });
            continue;
        }

        // ── Password auth ─────────────────────────────────────────────────────
        let Some(password) = conn.password.clone() else {
            continue;
        };
        let label = format!("{} ({}@{})", conn.name, conn.username, conn.host);
        prepared.push(PreparedMigration {
            index,
            label,
            kind: CredentialItemKind::SshPassword,
            secret: password,
        });
    }

    if prepared.is_empty() {
        return Ok(MigrationResult {
            migrated: 0,
            skipped,
            already_done,
            backup_path: None,
        });
    }

    let original_json = std::fs::read_to_string(&connections_path).map_err(|e| {
        VaultError::InvalidData(format!("backup read failed ({connections_path:?}): {e}"))
    })?;
    std::fs::write(&backup_path, &original_json).map_err(|e| {
        VaultError::InvalidData(format!("backup write failed ({backup_path:?}): {e}"))
    })?;

    let existing_records = vault.item_list()?;
    let mut existing_by_fingerprint: HashMap<(String, String, String), (String, u64)> = HashMap::new();
    for record in existing_records {
        let key = (
            record.kind.clone(),
            record.label.clone(),
            secret_fingerprint(&record.secret),
        );
        existing_by_fingerprint
            .entry(key)
            .and_modify(|current| {
                // Prefer the newest duplicate when earlier failed/stale migrations left
                // multiple records with the same generated migration label and secret.
                if record.created_at >= current.1 {
                    *current = (record.id.clone(), record.created_at);
                }
            })
            .or_insert((record.id.clone(), record.created_at));
    }

    let mut linked = Vec::new();
    let mut created_for_cleanup = Vec::new();
    for migration in &prepared {
        let kind = migration.kind.as_str();
        let lookup_key = (
            kind.to_string(),
            migration.label.clone(),
            secret_fingerprint(&migration.secret),
        );
        if let Some((existing_id, _)) = existing_by_fingerprint.get(&lookup_key) {
            linked.push((migration.index, existing_id.clone(), migration.kind.clone()));
            continue;
        }

        match vault.item_create(&migration.label, kind, &migration.secret, None) {
            Ok(record) => {
                let linked_record = (migration.index, record.id.clone(), migration.kind.clone());
                existing_by_fingerprint.insert(lookup_key, (record.id.clone(), record.created_at));
                created_for_cleanup.push(linked_record.clone());
                linked.push(linked_record);
            }
            Err(e) => {
                cleanup_created_items(vault, &created_for_cleanup);
                return Err(VaultError::InvalidData(format!("vault item create: {e}")));
            }
        }
    }

    for (index, record_id, kind) in &linked {
        let conn = &mut saved.connections[*index];
        conn.auth_ref = Some(CredentialRef {
            vault_id: vault_id.clone(),
            item_id: record_id.clone(),
            item_kind: kind.clone(),
            purpose: CredentialPurpose::SshAuth,
        });
        match kind {
            CredentialItemKind::SshPrivateKey => {
                conn.private_key_path = None;
                conn.password = None;
            }
            CredentialItemKind::SshPassword => {
                conn.password = None;
            }
            CredentialItemKind::SshAgentKey => {}
        }
    }

    let migrated = linked.len() as u32;
    let updated_json = serde_json::to_string_pretty(&saved).map_err(VaultError::Serde)?;
    if let Err(e) = atomic_write(&connections_path, &updated_json) {
        cleanup_created_items(vault, &created_for_cleanup);
        return Err(e);
    }

    Ok(MigrationResult {
        migrated,
        skipped,
        already_done,
        backup_path: Some(backup_path.to_string_lossy().into_owned()),
    })
}

fn secret_fingerprint(secret: &str) -> String {
    let digest = Sha256::digest(secret.as_bytes());
    base64::engine::general_purpose::STANDARD.encode(digest)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

struct PreparedMigration {
    index: usize,
    label: String,
    kind: CredentialItemKind,
    secret: String,
}

fn cleanup_created_items(vault: &VaultService, created: &[(usize, String, CredentialItemKind)]) {
    for (_, item_id, _) in created {
        let _ = vault.item_delete(item_id);
    }
}

fn load_connections(data_dir: &Path) -> Result<SavedData, VaultError> {
    let path = data_dir.join("connections.json");
    if !path.exists() {
        return Ok(SavedData {
            connections: vec![],
            folders: vec![],
        });
    }
    let raw = std::fs::read_to_string(&path)
        .map_err(|e| VaultError::InvalidData(format!("read connections.json: {e}")))?;
    serde_json::from_str(&raw).map_err(VaultError::Serde)
}

fn atomic_write(path: &Path, content: &str) -> Result<(), VaultError> {
    use std::io::Write;
    let unique_suffix = uuid::Uuid::new_v4();
    let tmp = path.with_extension(format!("json.tmp.{unique_suffix}"));
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&tmp)
        .map_err(|e| VaultError::InvalidData(format!("tmp write open: {e}")))?;
    f.write_all(content.as_bytes())
        .map_err(|e| VaultError::InvalidData(format!("tmp write: {e}")))?;
    f.sync_all()
        .map_err(|e| VaultError::InvalidData(format!("tmp sync: {e}")))?;
    drop(f);

    if path.exists() {
        let backup = path.with_extension(format!("json.replace-bak.{unique_suffix}"));
        std::fs::rename(path, &backup)
            .map_err(|e| VaultError::InvalidData(format!("atomic backup rename: {e}")))?;
        match std::fs::rename(&tmp, path) {
            Ok(()) => {
                let _ = std::fs::remove_file(&backup);
            }
            Err(rename_error) => {
                let _ = std::fs::rename(&backup, path);
                let _ = std::fs::remove_file(&tmp);
                return Err(VaultError::InvalidData(format!(
                    "atomic replace rename: {rename_error}"
                )));
            }
        }
    } else {
        std::fs::rename(&tmp, path)
            .map_err(|e| VaultError::InvalidData(format!("atomic rename: {e}")))?;
    }
    Ok(())
}
