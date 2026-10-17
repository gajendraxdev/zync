//! Native file/folder staging, publication and read-only restart recovery.
//! Moves deliberately retain their separate existing policy.

mod combine;
pub mod endpoint;
mod journal;
mod recovery;
mod tree;
pub use recovery::Inspection;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tree_tests;

use endpoint::{EntryKind, FileEndpoint, Snapshot};
use journal::Journal;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{atomic::AtomicBool, Arc, Mutex},
};
use tokio::{
    io::AsyncReadExt,
    sync::{Notify, Semaphore},
};

const BUFFER_SIZE: usize = 256 * 1024;
const MAX_ACTIVE: usize = 4;
const MAX_ADMITTED: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    Prepared,
    Writing,
    Ready,
    BackingUp,
    Publishing,
    Published,
    Completed,
    Cancelled,
    Failed,
    NeedsReview,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub version: u32,
    pub id: String,
    pub source_connection_id: String,
    pub source_path: String,
    pub destination_connection_id: String,
    pub destination_path: String,
    /// Hash of non-secret connection identity, never passwords/keys/auth configuration.
    pub destination_identity: String,
    pub destination_key: String,
    pub stage_path: String,
    pub backup_path: String,
    pub backup_expected: bool,
    pub phase: Phase,
    pub created_at: u64,
    pub transferred: u64,
    pub total: u64,
    pub error: Option<String>,
    pub warning: Option<String>,
    pub destination_unchanged: bool,
    /// Live cancellation confirmed that its staging path is absent. Old receipts
    /// default to false and never authorize cleanup of historical artifacts.
    #[serde(default)]
    pub stage_cleaned: bool,
    /// Clear affects history visibility only; unresolved safety evidence stays journaled.
    #[serde(default)]
    pub dismissed: bool,
    pub original: Option<Snapshot>,
    /// Captured only after writer/exec completion and CLOSE. Recovery must also
    /// verify phase, destination ownership and current metadata before removal.
    pub staged: Option<Snapshot>,
    /// Directory fingerprints are metadata change detectors, not content hashes.
    /// Absent in older regular-file receipts; never infer tree cleanup authority.
    #[serde(default)]
    pub original_tree: Option<tree::Fingerprint>,
    #[serde(default)]
    pub staged_tree: Option<tree::Fingerprint>,
    /// One current publication unit, not a durable per-file manifest.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub combine: Option<combine::Progress>,
}

impl Receipt {
    /// Restore live work and unresolved recovery, not ordinary session history.
    /// This projection never changes the journal or touches filesystem artifacts.
    pub fn for_restore(mut self, active: bool) -> Option<Self> {
        if !active && (self.dismissed || self.is_resolved()) {
            return None;
        }
        let unfinished_combine = self.combine.as_ref().is_some_and(|job| !job.finished);
        if active && unfinished_combine && self.phase == Phase::Completed {
            self.phase = Phase::Writing;
        }
        if !active
            && (unfinished_combine
                || matches!(
                    self.phase,
                    Phase::Prepared
                        | Phase::Writing
                        | Phase::Ready
                        | Phase::BackingUp
                        | Phase::Publishing
                        | Phase::Published
                ))
        {
            self.phase = Phase::NeedsReview;
            self.warning = Some(if unfinished_combine {
                "Interrupted folder combine. Completed items remain; nothing was automatically resumed or deleted. Inspect any current recovery paths before retrying."
            } else {
                "Interrupted transfer. Inspect the destination and recovery paths before retrying; nothing was automatically resumed or deleted."
            }.into());
        }
        Some(self)
    }

    fn is_resolved(&self) -> bool {
        !self.combine.as_ref().is_some_and(|job| !job.finished)
            && self.warning.is_none()
            && (self.phase == Phase::Completed
                || self.phase == Phase::Cancelled
                    && (self.combine.as_ref().is_some_and(|job| job.current_done)
                        || self.stage_cleaned && self.destination_unchanged))
    }

    fn validate(&self) -> Result<(), String> {
        if self.version != 1
            || self.combine.as_ref().is_some_and(|job| !job.valid())
            || self
                .original_tree
                .as_ref()
                .is_some_and(|tree| !tree.valid())
            || self.staged_tree.as_ref().is_some_and(|tree| !tree.valid())
            || self.stage_cleaned && (self.phase != Phase::Cancelled || !self.destination_unchanged)
            || uuid::Uuid::parse_str(&self.id).is_err()
            || [
                &self.source_path,
                &self.destination_path,
                &self.stage_path,
                &self.backup_path,
                &self.source_connection_id,
                &self.destination_connection_id,
                &self.destination_identity,
                &self.destination_key,
            ]
            .iter()
            .any(|value| value.is_empty() || value.len() > 4096 || value.contains('\0'))
        {
            return Err("Unsupported or invalid transfer recovery record".into());
        }
        Ok(())
    }
}

pub struct Request {
    pub id: String,
    pub source_connection_id: String,
    pub source_path: String,
    pub source_identity: String,
    pub destination_connection_id: String,
    pub destination_path: String,
    pub destination_identity: String,
    pub overwrite: bool,
    pub folder_mode: FolderCopyMode,
    pub stage_copy: Option<Arc<dyn StageCopy>>,
}

#[derive(Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderCopyMode {
    #[default]
    Replace,
    Combine,
}

/// Optional same-server acceleration. false means execution definitely did not
/// start; a failure/unknown acknowledgement must never trigger streamed replay.
#[async_trait::async_trait]
pub trait StageCopy: Send + Sync {
    async fn copy(&self, source: &str, stage: &str) -> Result<bool, String>;
}

pub struct Service {
    journal: Arc<Journal>,
    admission: Arc<Semaphore>,
    capacity: Arc<Semaphore>,
    waiting: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
    started: Option<Arc<dyn Fn(&Receipt) + Send + Sync>>,
    destinations: Arc<Mutex<HashSet<String>>>,
}

struct DestinationLease {
    key: String,
    destinations: Arc<Mutex<HashSet<String>>>,
}

struct WaitingLease {
    id: String,
    waiting: Arc<Mutex<HashMap<String, Arc<Notify>>>>,
}
impl Drop for WaitingLease {
    fn drop(&mut self) {
        if let Ok(mut waiting) = self.waiting.lock() {
            waiting.remove(&self.id);
        }
    }
}
impl Drop for DestinationLease {
    fn drop(&mut self) {
        if let Ok(mut destinations) = self.destinations.lock() {
            destinations.remove(&self.key);
        }
    }
}

impl Service {
    fn reserve_destination(&self, key: String) -> Result<DestinationLease, String> {
        let mut destinations = self
            .destinations
            .lock()
            .map_err(|_| "Transfer admission unavailable")?;
        if destinations
            .iter()
            .any(|owned| destination_keys_overlap(owned, &key))
        {
            return Err("Another native file operation owns this destination".into());
        }
        destinations.insert(key.clone());
        Ok(DestinationLease {
            key,
            destinations: self.destinations.clone(),
        })
    }

    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            journal: Arc::new(Journal::new(data_dir.join("file-transfers.redb"))),
            admission: Arc::new(Semaphore::new(MAX_ACTIVE)),
            capacity: Arc::new(Semaphore::new(MAX_ADMITTED)),
            waiting: Arc::new(Mutex::new(HashMap::new())),
            started: None,
            destinations: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn with_started_callback(
        mut self,
        callback: impl Fn(&Receipt) + Send + Sync + 'static,
    ) -> Self {
        self.started = Some(Arc::new(callback));
        self
    }

    pub async fn history(&self) -> Result<Vec<Receipt>, String> {
        self.journal.list().await
    }
    pub async fn dismiss(&self, id: String) -> Result<(), String> {
        self.journal.dismiss(id).await
    }

    /// Wake a queued job after the shared registry has recorded cancellation intent.
    pub fn wake_cancelled(&self, id: &str) {
        if let Ok(waiting) = self.waiting.lock() {
            if let Some(signal) = waiting.get(id) {
                signal.notify_one();
            }
        }
    }

    /// The user has manually resolved the artifacts. Only inspect and forget
    /// metadata here; never turn this acknowledgement into filesystem cleanup.
    pub async fn resolve_after_artifacts_removed(
        &self,
        id: String,
        destination: &dyn FileEndpoint,
    ) -> Result<(), String> {
        let receipt = self
            .history()
            .await?
            .into_iter()
            .find(|r| r.id == id)
            .ok_or("Recovery record not found")?;
        let _lease = self.reserve_destination(receipt.destination_key.clone())?;
        if destination.stat(&receipt.stage_path).await?.is_some()
            || destination.stat(&receipt.backup_path).await?.is_some()
        {
            return Err("Recovery files still exist. Review them manually; Zync will not delete them on acknowledgement".into());
        }
        self.journal.forget_reviewed(id).await
    }

    /// Four active jobs and a bounded admitted queue; queued cancellation never
    /// waits for another large file to finish. No stream is opened while queued.
    /// Canonical parent reservations cover this service, not external apps/legacy mutations.
    pub async fn execute(
        &self,
        request: Request,
        source: Arc<dyn FileEndpoint>,
        destination: Arc<dyn FileEndpoint>,
        token: Arc<AtomicBool>,
        progress: impl Fn(u64, u64) + Send + Sync,
    ) -> Result<Receipt, String> {
        let _capacity = self.capacity.clone().try_acquire_owned().map_err(|_| {
            "The file transfer queue is full; wait for a transfer to finish".to_string()
        })?;
        let signal = Arc::new(Notify::new());
        {
            let mut waiting = self
                .waiting
                .lock()
                .map_err(|_| "Transfer admission unavailable")?;
            if waiting.contains_key(&request.id) {
                return Err("Transfer ID is already queued".into());
            }
            waiting.insert(request.id.clone(), signal.clone());
        }
        let waiting = WaitingLease {
            id: request.id.clone(),
            waiting: self.waiting.clone(),
        };
        crate::transfers::check_cancelled(&token)?;
        let _permit = tokio::select! {
            result = self.admission.clone().acquire_owned() => result.map_err(|_| "Transfer admission unavailable")?,
            _ = signal.notified() => return Err("Cancelled".into()),
        };
        drop(waiting);
        crate::transfers::check_cancelled(&token)?;
        if request.folder_mode == FolderCopyMode::Combine {
            self.combine_folders(request, source, destination, token, progress)
                .await
        } else {
            self.execute_copy(request, source, destination, token, progress, None)
                .await
        }
    }

    /// Shared publication path. A combine unit borrows its parent's already
    /// admitted root lease; it never reacquires capacity or nests transfer jobs.
    async fn execute_copy(
        &self,
        request: Request,
        source: Arc<dyn FileEndpoint>,
        destination: Arc<dyn FileEndpoint>,
        token: Arc<AtomicBool>,
        progress: impl Fn(u64, u64) + Send + Sync,
        context: Option<combine::UnitContext<'_>>,
    ) -> Result<Receipt, String> {
        let (source_stat, parent, key, original) = self
            .prepare_paths(&request, source.as_ref(), destination.as_ref())
            .await?;
        let _lease = if let Some(context) = &context {
            self.check_borrowed_destination(context.scope, &key)?;
            if original != context.original {
                return Err("Destination changed after combine preflight; the current item was left unchanged".into());
            }
            None
        } else {
            Some(self.reserve_destination(key.clone())?)
        };
        self.check_journal_destination(&request.id, &key, context.is_some())
            .await?;
        if original.is_some() && !request.overwrite {
            return Err("Destination already exists; choose an explicit collision action".into());
        }
        let source_tree = if source_stat.kind == EntryKind::Directory {
            Some(tree::Inventory::capture(source.as_ref(), &request.source_path, &token).await?)
        } else {
            None
        };
        if let Some(plan) = &source_tree {
            plan.validate_destination(destination.as_ref(), &request.destination_path)?;
        }
        let original_tree = if original
            .as_ref()
            .is_some_and(|entry| entry.kind == EntryKind::Directory)
        {
            Some(
                tree::Inventory::capture(destination.as_ref(), &request.destination_path, &token)
                    .await?
                    .fingerprint,
            )
        } else {
            None
        };
        let mut receipt = Self::prepare_receipt(
            &request,
            destination.as_ref(),
            key,
            original,
            original_tree,
            source_tree
                .as_ref()
                .map_or(source_stat.size, |tree| tree.fingerprint.bytes),
            source_tree.is_some(),
        )?;
        if context
            .as_ref()
            .is_some_and(|context| context.bytes != receipt.total)
        {
            return Err(
                "Source size changed after combine preflight; current item unchanged".into(),
            );
        }
        receipt.combine = context.as_ref().map(|context| context.progress.clone());
        let artifact_key = |path: &str| -> Result<String, String> {
            Ok(format!(
                "{}:{}",
                receipt.destination_identity,
                destination.reservation_key(&parent, &destination.filename(path)?)
            ))
        };
        let reserve_artifact = |path: &str| -> Result<Option<DestinationLease>, String> {
            let key = artifact_key(path)?;
            if let Some(context) = &context {
                self.check_borrowed_destination(context.scope, &key)?;
                Ok(None)
            } else {
                self.reserve_destination(key).map(Some)
            }
        };
        let _stage_lease = reserve_artifact(&receipt.stage_path)?;
        let _backup_lease = reserve_artifact(&receipt.backup_path)?;
        receipt.validate()?;
        // Intent is durable before the first destination mutation. No progress-tick writes.
        self.journal.save(&receipt).await?;
        if let Some(started) = &self.started {
            started(&receipt);
        }
        let result = self
            .write_and_publish(
                &mut receipt,
                &source_stat,
                source_tree.as_ref(),
                source.as_ref(),
                destination.as_ref(),
                request.stage_copy,
                &token,
                progress,
            )
            .await;
        if let Err(error) = result {
            let publication_started = matches!(
                receipt.phase,
                Phase::BackingUp | Phase::Publishing | Phase::Published | Phase::Completed
            );
            if !publication_started {
                receipt.destination_unchanged = true;
            }
            if !publication_started
                && error == "Cancelled"
                && receipt.staged_tree.is_some()
                && !receipt.stage_cleaned
            {
                self.cancel_before_publication(&mut receipt, destination.as_ref())
                    .await;
            }
            receipt.phase = if publication_started {
                Phase::NeedsReview
            } else if error == "Cancelled" {
                Phase::Cancelled
            } else {
                Phase::Failed
            };
            receipt.error = Some(error.chars().take(2048).collect());
            if receipt.warning.is_none() && !receipt.stage_cleaned {
                receipt.warning = Some(if publication_started {
                "Publication outcome needs inspection. Do not retry, restore or delete recovery files blindly."
            } else {
                "Destination left unchanged. A separate staging file may remain; inspect it before cleanup."
                }.into());
            }
        }
        if let Err(error) = self.journal.save(&receipt).await {
            receipt.warning = Some(format!("Recovery receipt could not be saved: {error}. Inspect the recorded paths before retrying."));
        }
        Ok(receipt)
    }

    /// Read-only path/type/alias validation is shared by a whole copy and a
    /// combine root. Persisted reservation keys retain their existing policy.
    async fn prepare_paths(
        &self,
        request: &Request,
        source: &dyn FileEndpoint,
        destination: &dyn FileEndpoint,
    ) -> Result<(Snapshot, String, String, Option<Snapshot>), String> {
        let source_stat = source
            .stat(&request.source_path)
            .await?
            .ok_or("Source no longer exists")?;
        if !matches!(source_stat.kind, EntryKind::File | EntryKind::Directory) {
            return Err(
                "Staged transfers require a regular file or folder, not a link or special entry"
                    .into(),
            );
        }
        let parent_probe = destination.sibling(&request.destination_path, ".")?;
        let parent = destination.canonicalize(&parent_probe).await?;
        let leaf = destination.filename(&request.destination_path)?;
        let key = format!(
            "{}:{}",
            request.destination_identity,
            destination.reservation_key(&parent, &leaf)
        );
        let original = destination.stat(&request.destination_path).await?;
        if request.source_identity == request.destination_identity {
            let source_path = source.canonicalize(&request.source_path).await?;
            let source_key = format!(
                "{}:{}",
                request.source_identity,
                source
                    .reservation_key(&source_path, "")
                    .trim_end_matches('/')
            );
            // An existing leaf may itself be an alias (for example, a short
            // Windows name). Keep persisted reservations stable, but compare
            // its resolved location as well as the requested parent/leaf.
            let canonical_destination_key = if original.is_some() {
                let path = destination.canonicalize(&request.destination_path).await?;
                Some(format!(
                    "{}:{}",
                    request.destination_identity,
                    destination.reservation_key(&path, "").trim_end_matches('/')
                ))
            } else {
                None
            };
            if destination_keys_overlap(&source_key, &key)
                || canonical_destination_key
                    .as_ref()
                    .is_some_and(|resolved| destination_keys_overlap(&source_key, resolved))
            {
                return Err(
                    "Source and destination paths overlap; the original was left unchanged".into(),
                );
            }
        }
        if original
            .as_ref()
            .is_some_and(|entry| entry.kind != source_stat.kind)
        {
            return Err(
                "Source and destination entry types differ; destination was left unchanged".into(),
            );
        }
        Ok((source_stat, parent, key, original))
    }

    async fn check_journal_destination(
        &self,
        id: &str,
        key: &str,
        borrowed: bool,
    ) -> Result<(), String> {
        for old in self.journal.list().await? {
            if old.id == id {
                if borrowed {
                    continue;
                }
                return Err("Transfer ID already exists in recovery history".into());
            }
            if destination_keys_overlap(&old.destination_key, key)
                && matches!(
                    old.phase,
                    Phase::BackingUp | Phase::Publishing | Phase::Published | Phase::NeedsReview
                )
            {
                return Err("An interrupted publication owns this destination; inspect its recovery record before retrying".into());
            }
        }
        Ok(())
    }

    fn check_borrowed_destination(
        &self,
        scope: &DestinationLease,
        key: &str,
    ) -> Result<(), String> {
        let root = normalized_destination_key(&scope.key);
        let child = normalized_destination_key(key);
        let root = root.trim_end_matches('/');
        if !Arc::ptr_eq(&self.destinations, &scope.destinations)
            || !(child == root
                || child
                    .strip_prefix(root)
                    .is_some_and(|tail| tail.starts_with('/')))
        {
            return Err("Combine destination escaped its reserved folder".into());
        }
        Ok(())
    }

    fn prepare_receipt(
        request: &Request,
        destination: &dyn FileEndpoint,
        key: String,
        original: Option<Snapshot>,
        original_tree: Option<tree::Fingerprint>,
        total: u64,
        folder: bool,
    ) -> Result<Receipt, String> {
        let artifact_id = uuid::Uuid::new_v4();
        Ok(Receipt {
            dismissed: false,
            version: 1,
            id: request.id.clone(),
            source_connection_id: request.source_connection_id.clone(),
            source_path: request.source_path.clone(),
            destination_connection_id: request.destination_connection_id.clone(),
            destination_path: request.destination_path.clone(),
            destination_identity: request.destination_identity.clone(),
            destination_key: key,
            stage_path: destination.sibling(
                &request.destination_path,
                &format!(".zync-transfer-{artifact_id}.part"),
            )?,
            backup_path: destination.sibling(
                &request.destination_path,
                &format!(".zync-transfer-{artifact_id}.backup"),
            )?,
            backup_expected: original.is_some() && (destination.requires_backup() || folder),
            phase: Phase::Prepared,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            transferred: 0,
            total,
            error: None,
            warning: None,
            destination_unchanged: true,
            stage_cleaned: false,
            original,
            staged: None,
            original_tree,
            staged_tree: None,
            combine: None,
        })
    }

    async fn advance(&self, receipt: &mut Receipt, phase: Phase) -> Result<(), String> {
        // Save intent first. If the save fails, no next filesystem mutation is allowed.
        let mut next = receipt.clone();
        next.phase = phase;
        self.journal.save(&next).await?;
        *receipt = next;
        Ok(())
    }

    async fn write_and_publish(
        &self,
        receipt: &mut Receipt,
        source_stat: &Snapshot,
        source_tree: Option<&tree::Inventory>,
        source: &dyn FileEndpoint,
        destination: &dyn FileEndpoint,
        stage_copy: Option<Arc<dyn StageCopy>>,
        token: &Arc<AtomicBool>,
        progress: impl Fn(u64, u64) + Send + Sync,
    ) -> Result<(), String> {
        self.advance(receipt, Phase::Writing).await?;
        // Throttle once per job, not once per nested file. Small streamed files
        // must advance progress too; accelerated leaves must not flood IPC.
        let last_emit = Mutex::new(std::time::Instant::now());
        let report_progress = |done, total| {
            let emit = last_emit
                .lock()
                .is_ok_and(|mut last| progress_due(&mut last, std::time::Instant::now()));
            if emit {
                progress(done, total);
            }
        };
        if let Some(plan) = source_tree {
            destination
                .prepare_directory_publish(&receipt.destination_path)
                .await?;
            progress(0, receipt.total);
            self.write_tree(
                receipt,
                source,
                destination,
                plan,
                stage_copy.as_deref(),
                token,
                &report_progress,
            )
            .await?;
        } else {
            destination
                .prepare_publish(
                    &receipt.destination_path,
                    receipt.original.is_some() && !receipt.backup_expected,
                )
                .await?;
            progress(0, receipt.total);
            let source_path = receipt.source_path.clone();
            let stage_path = receipt.stage_path.clone();
            let (copy, closed) = self
                .copy_file_data(
                    receipt,
                    &source_path,
                    &stage_path,
                    source_stat.size,
                    source,
                    destination,
                    stage_copy.as_deref(),
                    token,
                    &report_progress,
                )
                .await;
            match copy {
                Err(error) if error == "Cancelled" && closed => {
                    self.cancel_before_publication(receipt, destination).await;
                    return Err(error);
                }
                Err(error) => return Err(error),
                Ok(()) => {}
            }
            // A final buffered write can finish after cancellation without another
            // stream iteration. Honor that request before any post-copy metadata I/O.
            if crate::transfers::check_cancelled(token).is_err() {
                self.cancel_before_publication(receipt, destination).await;
                return Err("Cancelled".into());
            }
            if receipt.transferred != source_stat.size
                || source.stat(&receipt.source_path).await?.as_ref() != Some(source_stat)
            {
                return Err("Source changed during copying; replacement was not published".into());
            }
            destination
                .set_mode(
                    &receipt.stage_path,
                    receipt
                        .original
                        .as_ref()
                        .and_then(|s| s.mode)
                        .or(source_stat.mode)
                        .or(Some(0o644)),
                )
                .await?;
            receipt.staged = destination.stat(&receipt.stage_path).await?;
            if !receipt
                .staged
                .as_ref()
                .is_some_and(|s| s.kind == EntryKind::File && s.size == receipt.transferred)
            {
                return Err(
                    "Staging file changed or its completed size could not be verified".into(),
                );
            }
        }
        self.advance(receipt, Phase::Ready).await?;
        if crate::transfers::check_cancelled(token).is_err() {
            if receipt.staged_tree.is_none() {
                self.cancel_before_publication(receipt, destination).await;
            }
            return Err("Cancelled".into());
        }
        if let Some(expected) = &receipt.staged_tree {
            if tree::Inventory::capture(destination, &receipt.stage_path, token)
                .await?
                .fingerprint
                != *expected
            {
                return Err(
                    "Temporary folder changed before publication; destination unchanged".into(),
                );
            }
        }
        if destination.stat(&receipt.stage_path).await? != receipt.staged {
            return Err(
                "Temporary copy changed before publication; destination was left unchanged".into(),
            );
        }
        // Scan staging first: checking the original last avoids leaving the
        // entire staging walk between its verification and publication.
        if destination.stat(&receipt.destination_path).await? != receipt.original {
            return Err("Destination changed during copying; replacement was not published".into());
        }
        if let Some(expected) = &receipt.original_tree {
            if tree::Inventory::capture(destination, &receipt.destination_path, token)
                .await?
                .fingerprint
                != *expected
            {
                return Err(
                    "Destination folder changed during copying; replacement was not published"
                        .into(),
                );
            }
        }
        if crate::transfers::check_cancelled(token).is_err() {
            if receipt.staged_tree.is_none() {
                self.cancel_before_publication(receipt, destination).await;
            }
            return Err("Cancelled".into());
        }
        // Commit boundary: cancellation after this point is not an undo request.
        let backup = receipt.backup_expected;
        if backup {
            receipt.destination_unchanged = false;
            self.advance(receipt, Phase::BackingUp).await?;
            destination
                .rename_absent(&receipt.destination_path, &receipt.backup_path)
                .await?;
        }
        receipt.destination_unchanged = false;
        self.advance(receipt, Phase::Publishing).await?;
        destination
            .publish(
                &receipt.stage_path,
                &receipt.destination_path,
                receipt.original.is_some() && !backup,
            )
            .await?;
        // Record acknowledged publication before cleanup. A crash never authorizes replay.
        self.advance(receipt, Phase::Published).await?;
        if backup {
            match destination.stat(&receipt.backup_path).await {
                Ok(snapshot) if snapshot == receipt.original => {
                    let removed = if let Some(expected) = &receipt.original_tree {
                        tree::remove_verified_tree(destination, &receipt.backup_path, expected).await
                    } else { destination.remove(&receipt.backup_path).await };
                    if let Err(error) = removed {
                        receipt.warning = Some(format!("Published successfully, but original backup cleanup failed: {error}"));
                    }
                }
                _ => receipt.warning = Some("Published successfully, but original backup could not be verified; it was retained".into()),
            }
        }
        if let Some(job) = &mut receipt.combine {
            job.completed_items += 1;
            job.completed_bytes += receipt.total;
            job.current_done = true;
        }
        self.advance(receipt, Phase::Completed).await?;
        progress(receipt.transferred, receipt.total);
        Ok(())
    }

    /// Only called for this live job after its writes/exec and CLOSE have returned,
    /// before publication. Never sweep historical paths or touch an original backup.
    async fn cancel_before_publication(
        &self,
        receipt: &mut Receipt,
        destination: &dyn FileEndpoint,
    ) {
        if let Err(error) = self.remove_cancelled_stage(receipt, destination).await {
            receipt.warning = Some(format!("Copy cancelled, but temporary-file cleanup could not be confirmed: {error}. Inspect recovery files before cleanup."));
        }
    }

    async fn remove_cancelled_stage(
        &self,
        receipt: &mut Receipt,
        destination: &dyn FileEndpoint,
    ) -> Result<(), String> {
        if !receipt.destination_unchanged
            || !matches!(receipt.phase, Phase::Writing | Phase::Ready)
            || receipt.stage_path == receipt.destination_path
            || receipt.stage_path == receipt.backup_path
        {
            return Err("The staging cleanup preconditions were not met".into());
        }
        // The path was exclusively created by this running job. Check its live
        // parent and metadata before unlinking; this is not hostile-directory or
        // inode confinement, which SFTPv3 cannot provide by pathname.
        let parent = destination
            .canonicalize(&destination.sibling(&receipt.destination_path, ".")?)
            .await?;
        let key = format!(
            "{}:{}",
            receipt.destination_identity,
            destination.reservation_key(&parent, &destination.filename(&receipt.destination_path)?)
        );
        if normalized_destination_key(&key) != normalized_destination_key(&receipt.destination_key)
        {
            return Err("Destination parent changed".into());
        }
        if let Some(current) = destination.stat(&receipt.stage_path).await? {
            if let Some(expected) = &receipt.staged_tree {
                if current.kind != EntryKind::Directory || receipt.staged.as_ref() != Some(&current)
                {
                    return Err("The temporary folder changed; it was not deleted".into());
                }
                self.journal.save(receipt).await?;
                tree::remove_verified_tree(destination, &receipt.stage_path, expected).await?;
                receipt.stage_cleaned = true;
                return Ok(());
            }
            if current.kind != EntryKind::File
                || current.size != receipt.transferred
                || receipt
                    .staged
                    .as_ref()
                    .is_some_and(|expected| expected != &current)
            {
                return Err("The temporary path changed; it was not deleted".into());
            }
            // Persist intent before deletion. A crash here still retains a recovery
            // path; startup never replays this cleanup automatically.
            receipt.staged = Some(current);
            self.journal.save(receipt).await?;
            let removed = destination.remove(&receipt.stage_path).await;
            if destination.stat(&receipt.stage_path).await?.is_some() {
                return Err(removed
                    .err()
                    .unwrap_or_else(|| "The temporary path is still present".into()));
            }
        }
        receipt.stage_cleaned = true;
        Ok(())
    }

    async fn stream(
        &self,
        receipt: &mut Receipt,
        source: &dyn FileEndpoint,
        source_path: &str,
        writer: &mut dyn endpoint::StageWriter,
        token: &Arc<AtomicBool>,
        progress: &(impl Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        let mut reader = source.reader(source_path).await?;
        // Overlap source reads and destination writes without a whole-file buffer.
        // At most two queued 256KiB chunks plus one reader and one writer chunk.
        let (sender, mut receiver) = tokio::sync::mpsc::channel::<Vec<u8>>(2);
        let reader_token = token.clone();
        let reading = tokio::spawn(async move {
            loop {
                crate::transfers::check_cancelled(&reader_token)?;
                let mut buffer = vec![0u8; BUFFER_SIZE];
                let count = reader
                    .read(&mut buffer)
                    .await
                    .map_err(|e| format!("Source read failed: {e}"))?;
                if count == 0 {
                    break;
                }
                buffer.truncate(count);
                if sender.send(buffer).await.is_err() {
                    break;
                }
            }
            Ok::<(), String>(())
        });
        let copy = async {
            while let Some(buffer) = receiver.recv().await {
                crate::transfers::check_cancelled(token)?;
                writer.write(&buffer).await?;
                receipt.transferred += buffer.len() as u64;
                progress(receipt.transferred, receipt.total);
            }
            Ok::<(), String>(())
        }
        .await;
        receiver.close();
        if copy.is_err() {
            reading.abort();
        }
        let read_result = reading
            .await
            .map_err(|_| "Source reader task failed unexpectedly".to_string())
            .and_then(|r| r);
        copy.and(read_result)
    }

    /// Share the exact same bounded data path and acknowledged CLOSE for a
    /// standalone file and each file in a folder. Unknown exec/create/close
    /// outcomes never authorize recursive cancellation cleanup.
    async fn copy_file_data(
        &self,
        receipt: &mut Receipt,
        source_path: &str,
        stage_path: &str,
        size: u64,
        source: &dyn FileEndpoint,
        destination: &dyn FileEndpoint,
        acceleration: Option<&dyn StageCopy>,
        token: &Arc<AtomicBool>,
        progress: &(impl Fn(u64, u64) + Send + Sync),
    ) -> (Result<(), String>, bool) {
        let mut writer = match destination.create_stage(stage_path).await {
            Ok(writer) => writer,
            Err(error) => return (Err(error), false),
        };
        let mut confirmed = true;
        let copied = async {
            if let Some(acceleration) = acceleration {
                crate::transfers::check_cancelled(token)?;
                confirmed = false;
                let accelerated =
                    acceleration
                        .copy(source_path, stage_path)
                        .await
                        .map_err(|error| {
                            format!("Server-side copy outcome was not confirmed: {error}")
                        })?;
                confirmed = true;
                if accelerated {
                    receipt.transferred += size;
                    progress(receipt.transferred, receipt.total);
                    return Ok(());
                }
            }
            self.stream(
                receipt,
                source,
                source_path,
                writer.as_mut(),
                token,
                progress,
            )
            .await
        }
        .await;
        let closed = writer.finish().await;
        let safe = confirmed && closed.is_ok();
        let result = match (copied, closed) {
            (Err(error), Err(close)) => Err(format!("{error}; {close}")),
            (Err(error), _) | (_, Err(error)) => Err(error),
            _ => Ok(()),
        };
        (result, safe)
    }
}

/// A caller-supplied clock keeps the job-wide progress gate deterministic in tests.
fn progress_due(last: &mut std::time::Instant, now: std::time::Instant) -> bool {
    if now.duration_since(*last) < std::time::Duration::from_millis(100) {
        return false;
    }
    *last = now;
    true
}

/// Keys include endpoint identity and canonical parent. Ancestor reservations
/// prevent a concurrent native child writer from racing folder publication.
fn destination_keys_overlap(left: &str, right: &str) -> bool {
    let left = normalized_destination_key(left);
    let right = normalized_destination_key(right);
    let (left, right) = (left.trim_end_matches('/'), right.trim_end_matches('/'));
    left == right
        || left
            .strip_prefix(right)
            .is_some_and(|tail| tail.starts_with('/'))
        || right
            .strip_prefix(left)
            .is_some_and(|tail| tail.starts_with('/'))
}

/// Comparison only: preserve persisted keys while reconciling old Windows
/// separators and the doubled slash produced by joining a POSIX root parent.
/// Remote POSIX backslashes and Windows local UNC prefixes remain literal.
fn normalized_destination_key(key: &str) -> std::borrow::Cow<'_, str> {
    if cfg!(windows) && key.starts_with("local:") {
        return key.replace('\\', "/").into();
    }
    if let Some((identity, path)) = key.split_once(":/") {
        if path.starts_with('/') {
            return format!("{identity}:/{}", path.trim_start_matches('/')).into();
        }
    }
    key.into()
}
