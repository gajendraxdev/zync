//! Bounded, transactional metadata only. File contents and credentials never enter this store.

use super::Receipt;
use redb::{Database, ReadableTable, ReadableTableMetadata, TableDefinition};
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

const RECORDS: TableDefinition<&str, &[u8]> = TableDefinition::new("file_transfers_v1");
const MAX_RECORDS: u64 = 256;
// Cleared safety evidence has a separate allowance; never make it unbounded.
const MAX_TOTAL_RECORDS: u64 = 512;
const MAX_RECORD_BYTES: usize = 32 * 1024;

pub struct Journal {
    path: PathBuf,
    database: OnceLock<Result<Arc<Database>, String>>,
    #[cfg(test)]
    pub(super) fail_phase: std::sync::Mutex<Option<super::Phase>>,
}

impl Journal {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            database: OnceLock::new(),
            #[cfg(test)]
            fail_phase: std::sync::Mutex::new(None),
        }
    }

    // Only called on blocking workers; a failed/corrupt journal disables staged
    // mutations instead of silently discarding the previous recovery state.
    fn database(&self) -> Result<Arc<Database>, String> {
        self.database
            .get_or_init(|| {
                if let Some(parent) = self.path.parent() {
                    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let database = Database::create(&self.path).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600))
                        .map_err(|e| e.to_string())?;
                }
                let transaction = database.begin_write().map_err(|e| e.to_string())?;
                transaction.open_table(RECORDS).map_err(|e| e.to_string())?;
                transaction.commit().map_err(|e| e.to_string())?;
                Ok(Arc::new(database))
            })
            .clone()
            .map_err(|e| format!("Transfer recovery history unavailable: {e}"))
    }

    pub async fn save(self: &Arc<Self>, receipt: &Receipt) -> Result<(), String> {
        #[cfg(test)]
        if self.fail_phase.lock().unwrap().as_ref() == Some(&receipt.phase) {
            return Err("Injected journal commit failure".into());
        }
        let journal = self.clone();
        let receipt = receipt.clone();
        tokio::task::spawn_blocking(move || {
            let bytes = serde_json::to_vec(&receipt).map_err(|e| e.to_string())?;
            if bytes.len() > MAX_RECORD_BYTES {
                return Err("Transfer record is too large".into());
            }
            let db = journal.database()?;
            let transaction = db.begin_write().map_err(|e| e.to_string())?;
            {
                let mut table = transaction.open_table(RECORDS).map_err(|e| e.to_string())?;
                // Bound resolved history without ever expiring interrupted jobs
                // or cleanup warnings. Recovery records are not ordinary receipts.
                let mut completed = Vec::new();
                let mut visible = 0;
                for item in table.iter().map_err(|e| e.to_string())? {
                    let (key, value) = item.map_err(|e| e.to_string())?;
                    let saved: Receipt =
                        serde_json::from_slice(value.value()).map_err(|e| e.to_string())?;
                    if !saved.dismissed { visible += 1; }
                    if saved.is_resolved() && saved.id != receipt.id {
                        completed.push((saved.created_at, key.value().to_owned()));
                    }
                }
                completed.sort();
                let excess = completed.len().saturating_sub(19);
                for (_, key) in completed.into_iter().take(excess) {
                    if let Some(value) = table.remove(key.as_str()).map_err(|e| e.to_string())? {
                        let saved: Receipt = serde_json::from_slice(value.value()).map_err(|e| e.to_string())?;
                        if !saved.dismissed { visible -= 1; }
                    }
                }
                let previous: Option<Receipt> = table.get(receipt.id.as_str()).map_err(|e| e.to_string())?
                    .map(|value| serde_json::from_slice(value.value()).map_err(|e| e.to_string())).transpose()?;
                let next_visible = visible - u64::from(previous.as_ref().is_some_and(|saved| !saved.dismissed))
                    + u64::from(!receipt.dismissed);
                if next_visible > MAX_RECORDS {
                    return Err(
                        "Transfer history is full; review and dismiss resolved transfers first"
                            .into(),
                    );
                }
                if previous.is_none() && table.len().map_err(|e| e.to_string())? >= MAX_TOTAL_RECORDS {
                    return Err("Transfer safety journal is full; retained recovery evidence must be resolved before more transfers can start".into());
                }
                table
                    .insert(receipt.id.as_str(), bytes.as_slice())
                    .map_err(|e| e.to_string())?;
            }
            transaction
                .commit()
                .map_err(|e| format!("Could not save transfer recovery state: {e}"))
        })
        .await
        .map_err(|e| e.to_string())?
    }

    pub async fn list(self: &Arc<Self>) -> Result<Vec<Receipt>, String> {
        let journal = self.clone();
        tokio::task::spawn_blocking(move || {
            let db = journal.database()?;
            let transaction = db.begin_read().map_err(|e| e.to_string())?;
            let table = transaction.open_table(RECORDS).map_err(|e| e.to_string())?;
            if table.len().map_err(|e| e.to_string())? > MAX_TOTAL_RECORDS {
                return Err("Transfer recovery history exceeds its supported bound".into());
            }
            let mut receipts = Vec::new();
            for item in table.iter().map_err(|e| e.to_string())? {
                let (_, value) = item.map_err(|e| e.to_string())?;
                if value.value().len() > MAX_RECORD_BYTES {
                    return Err("Invalid transfer recovery record".into());
                }
                let receipt: Receipt = serde_json::from_slice(value.value())
                    .map_err(|e| format!("Invalid transfer recovery record: {e}"))?;
                receipt.validate()?;
                receipts.push(receipt);
            }
            receipts.sort_by(|a, b| b.created_at.cmp(&a.created_at));
            Ok(receipts)
        })
        .await
        .map_err(|e| e.to_string())?
    }

    /// Clear history without deleting artifacts or discarding unresolved safety evidence.
    pub async fn dismiss(self: &Arc<Self>, id: String) -> Result<(), String> {
        self.remove(id, false).await
    }

    pub(super) async fn forget_reviewed(self: &Arc<Self>, id: String) -> Result<(), String> {
        self.remove(id, true).await
    }

    async fn remove(self: &Arc<Self>, id: String, reviewed: bool) -> Result<(), String> {
        let journal = self.clone();
        tokio::task::spawn_blocking(move || {
            let db = journal.database()?;
            let transaction = db.begin_write().map_err(|e| e.to_string())?;
            {
                let mut table = transaction.open_table(RECORDS).map_err(|e| e.to_string())?;
                let mut receipt: Receipt =
                    match table.get(id.as_str()).map_err(|e| e.to_string())? {
                        Some(value) => {
                            serde_json::from_slice(value.value()).map_err(|e| e.to_string())?
                        }
                        None => return Ok(()),
                    };
                if reviewed || receipt.is_resolved() {
                    table.remove(id.as_str()).map_err(|e| e.to_string())?;
                } else {
                    receipt.dismissed = true;
                    let bytes = serde_json::to_vec(&receipt).map_err(|e| e.to_string())?;
                    if bytes.len() > MAX_RECORD_BYTES {
                        return Err("Transfer record is too large".into());
                    }
                    table
                        .insert(id.as_str(), bytes.as_slice())
                        .map_err(|e| e.to_string())?;
                }
            }
            transaction.commit().map_err(|e| e.to_string())
        })
        .await
        .map_err(|e| e.to_string())?
    }
}
