//! Native regular-file staging, publication and read-only restart recovery.
//! Directories and moves deliberately retain their separate existing policies.

pub mod endpoint;
mod journal;
mod recovery;
pub use recovery::Inspection;
#[cfg(test)]
mod tests;

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
}

impl Receipt {
    /// Restore live work and unresolved recovery, not ordinary session history.
    /// This projection never changes the journal or touches filesystem artifacts.
    pub fn for_restore(mut self, active: bool) -> Option<Self> {
        if !active && (self.dismissed || self.is_resolved()) {
            return None;
        }
        if !active
            && matches!(
                self.phase,
                Phase::Prepared
                    | Phase::Writing
                    | Phase::Ready
                    | Phase::BackingUp
                    | Phase::Publishing
                    | Phase::Published
            )
        {
            self.phase = Phase::NeedsReview;
            self.warning = Some("Interrupted transfer. Inspect the destination and recovery paths before retrying; nothing was automatically resumed or deleted.".into());
        }
        Some(self)
    }

    fn is_resolved(&self) -> bool {
        self.warning.is_none()
            && (self.phase == Phase::Completed
                || self.phase == Phase::Cancelled
                    && self.stage_cleaned
                    && self.destination_unchanged)
    }

    fn validate(&self) -> Result<(), String> {
        if self.version != 1
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
    pub destination_connection_id: String,
    pub destination_path: String,
    pub destination_identity: String,
    pub overwrite: bool,
    pub stage_copy: Option<Arc<dyn StageCopy>>,
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
        if !destinations.insert(key.clone()) {
            return Err("Another native file operation owns this destination".into());
        }
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
        let source_stat = source
            .stat(&request.source_path)
            .await?
            .ok_or("Source file no longer exists")?;
        if source_stat.kind != EntryKind::File {
            return Err("Staged transfers require a regular file, not a link or directory".into());
        }
        let parent_probe = destination.sibling(&request.destination_path, ".")?;
        let parent = destination.canonicalize(&parent_probe).await?;
        let leaf = destination.filename(&request.destination_path)?;
        let key = format!(
            "{}:{}",
            request.destination_identity,
            destination.reservation_key(&parent, &leaf)
        );
        let _lease = self.reserve_destination(key.clone())?;
        for old in self.journal.list().await? {
            if old.id == request.id {
                return Err("Transfer ID already exists in recovery history".into());
            }
            if old.destination_key == key
                && matches!(
                    old.phase,
                    Phase::BackingUp | Phase::Publishing | Phase::Published | Phase::NeedsReview
                )
            {
                return Err("An interrupted publication owns this destination; inspect its recovery record before retrying".into());
            }
        }
        let original = destination.stat(&request.destination_path).await?;
        if original
            .as_ref()
            .is_some_and(|entry| entry.kind != EntryKind::File)
        {
            return Err("The destination is not a regular file; it was left unchanged".into());
        }
        if original.is_some() && !request.overwrite {
            return Err("Destination already exists; choose an explicit collision action".into());
        }
        let artifact_id = uuid::Uuid::new_v4();
        let mut receipt = Receipt {
            dismissed: false,
            version: 1,
            id: request.id,
            source_connection_id: request.source_connection_id,
            source_path: request.source_path,
            destination_connection_id: request.destination_connection_id,
            destination_path: request.destination_path.clone(),
            destination_identity: request.destination_identity,
            destination_key: key,
            stage_path: destination.sibling(
                &request.destination_path,
                &format!(".zync-transfer-{artifact_id}.part"),
            )?,
            backup_path: destination.sibling(
                &request.destination_path,
                &format!(".zync-transfer-{artifact_id}.backup"),
            )?,
            backup_expected: original.is_some() && destination.requires_backup(),
            phase: Phase::Prepared,
            created_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
            transferred: 0,
            total: source_stat.size,
            error: None,
            warning: None,
            destination_unchanged: true,
            stage_cleaned: false,
            original,
            staged: None,
        };
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
        source: &dyn FileEndpoint,
        destination: &dyn FileEndpoint,
        stage_copy: Option<Arc<dyn StageCopy>>,
        token: &Arc<AtomicBool>,
        progress: impl Fn(u64, u64) + Send + Sync,
    ) -> Result<(), String> {
        self.advance(receipt, Phase::Writing).await?;
        destination
            .prepare_publish(
                &receipt.destination_path,
                receipt.original.is_some() && !receipt.backup_expected,
            )
            .await?;
        let mut writer = destination.create_stage(&receipt.stage_path).await?;
        progress(0, receipt.total);
        let copy = async {
            if let Some(acceleration) = stage_copy {
                crate::transfers::check_cancelled(token)?;
                if acceleration
                    .copy(&receipt.source_path, &receipt.stage_path)
                    .await
                    .map_err(|error| {
                        format!("Server-side copy outcome was not confirmed: {error}")
                    })?
                {
                    receipt.transferred = receipt.total;
                    return Ok(());
                }
            }
            self.stream(receipt, source, writer.as_mut(), token, &progress)
                .await
        }
        .await;
        // Never abort/drop a pending write and pretend cancellation was acknowledged.
        let closed = writer.finish().await;
        drop(writer);
        match (copy, closed) {
            (Err(error), Err(close)) => return Err(format!("{error}; {close}")),
            (Err(error), Ok(())) if error == "Cancelled" => {
                self.cancel_before_publication(receipt, destination).await;
                return Err(error);
            }
            (Err(error), _) => return Err(error),
            (_, Err(error)) => return Err(error),
            _ => {}
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
            return Err("Staging file changed or its completed size could not be verified".into());
        }
        self.advance(receipt, Phase::Ready).await?;
        if crate::transfers::check_cancelled(token).is_err() {
            self.cancel_before_publication(receipt, destination).await;
            return Err("Cancelled".into());
        }
        if destination.stat(&receipt.destination_path).await? != receipt.original {
            return Err("Destination changed during copying; replacement was not published".into());
        }
        if destination.stat(&receipt.stage_path).await? != receipt.staged {
            return Err(
                "Staging file changed before publication; destination was left unchanged".into(),
            );
        }
        if crate::transfers::check_cancelled(token).is_err() {
            self.cancel_before_publication(receipt, destination).await;
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
                    if let Err(error) = destination.remove(&receipt.backup_path).await {
                        receipt.warning = Some(format!("Published successfully, but original backup cleanup failed: {error}"));
                    }
                }
                _ => receipt.warning = Some("Published successfully, but original backup could not be verified; it was retained".into()),
            }
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
        if key != receipt.destination_key {
            return Err("Destination parent changed".into());
        }
        if let Some(current) = destination.stat(&receipt.stage_path).await? {
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
        writer: &mut dyn endpoint::StageWriter,
        token: &Arc<AtomicBool>,
        progress: &(impl Fn(u64, u64) + Send + Sync),
    ) -> Result<(), String> {
        let mut reader = source.reader(&receipt.source_path).await?;
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
        let mut last_emit = std::time::Instant::now();
        let copy = async {
            while let Some(buffer) = receiver.recv().await {
                crate::transfers::check_cancelled(token)?;
                writer.write(&buffer).await?;
                receipt.transferred += buffer.len() as u64;
                if last_emit.elapsed().as_millis() >= 100 {
                    progress(receipt.transferred, receipt.total);
                    last_emit = std::time::Instant::now();
                }
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
}
