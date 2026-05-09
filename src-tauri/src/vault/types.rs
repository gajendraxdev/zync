use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Stored in redb vault_meta table under key "meta".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMeta {
    pub vault_id: String,
    pub schema_version: u32,
    pub crypto_suite: String,
    /// Base64-encoded 32-byte Argon2id salt.
    pub salt: String,
    pub kdf_m_cost: u32,
    pub kdf_t_cost: u32,
    pub kdf_p_cost: u32,
    #[serde(default)]
    pub live_records: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Returned by vault IPC status/initialize/unlock commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum VaultStatus {
    Uninitialized,
    Locked { vault_id: String },
    Unlocked { vault_id: String, item_count: u64 },
}

/// Plaintext record payload — only exists in memory after decryption.
#[derive(Clone, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase")]
pub struct PlaintextRecord {
    pub id: String,
    /// e.g. "ssh-password", "ssh-private-key", "api-key", "secure-note"
    pub kind: String,
    pub label: String,
    pub secret: String,
    pub notes: Option<String>,
    pub revision: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Metadata-only vault item DTO for renderer list views.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItemMeta {
    pub id: String,
    pub kind: String,
    pub label: String,
    /// Stable hash of the decrypted secret for equality-only UI workflows.
    /// The plaintext secret is never serialized by the list API.
    pub secret_fingerprint: String,
    pub revision: u64,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Stored in redb records and key_slots tables as JSON bytes.
/// Contains encrypted payload; `id` and `kind` are minimal plaintext index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredEnvelope {
    pub id: String,
    pub kind: String,
    pub revision: u64,
    pub deleted: bool,
    pub crypto_suite: String,
    pub aad_version: u32,
    /// Base64-encoded 24-byte XChaCha20 nonce.
    pub nonce: String,
    /// Base64-encoded ciphertext + 16-byte Poly1305 tag.
    pub ciphertext: String,
}
