use super::endpoint::{Endpoint, Reader, StageWriter};
use super::*;
use async_trait::async_trait;
use std::{collections::BTreeMap, sync::atomic::Ordering};

#[derive(Clone, Default)]
struct Faults {
    write: bool,
    close: bool,
    backup: bool,
    publish: bool,
    lost_publish_ack: bool,
    cleanup: bool,
    cancel_on_write: Option<Arc<AtomicBool>>,
    cancel_on_publish: Option<Arc<AtomicBool>>,
    cancel_on_mode: Option<Arc<AtomicBool>>,
    replace_on_close: bool,
    stat_after_close: bool,
    publish_preflight: bool,
    cleanup_journal: Option<Arc<Journal>>,
    colliding_names: bool,
    canonical_target: Option<String>,
}

#[derive(Clone)]
struct FakeEndpoint {
    files: Arc<Mutex<BTreeMap<String, Vec<u8>>>>,
    faults: Arc<Mutex<Faults>>,
    backup: bool,
    closed: Arc<AtomicBool>,
}

impl FakeEndpoint {
    fn new(backup: bool) -> Self {
        Self {
            files: Arc::new(Mutex::new(BTreeMap::from([
                ("/source".into(), b"new content".to_vec()),
                ("/target".into(), b"original".to_vec()),
            ]))),
            faults: Arc::new(Mutex::new(Faults::default())),
            backup,
            closed: Arc::new(AtomicBool::new(false)),
        }
    }
    fn bytes(&self, path: &str) -> Option<Vec<u8>> {
        self.files.lock().unwrap().get(path).cloned()
    }
    fn artifacts(&self) -> Vec<String> {
        self.files
            .lock()
            .unwrap()
            .keys()
            .filter(|p| p.starts_with("/.zync-transfer-"))
            .cloned()
            .collect()
    }
}

struct FakeWriter {
    endpoint: FakeEndpoint,
    path: String,
}
#[async_trait]
impl StageWriter for FakeWriter {
    async fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        let faults = self.endpoint.faults.lock().unwrap().clone();
        self.endpoint
            .files
            .lock()
            .unwrap()
            .get_mut(&self.path)
            .unwrap()
            .extend_from_slice(bytes);
        if let Some(token) = faults.cancel_on_write {
            token.store(true, Ordering::Relaxed);
        }
        if let Some(journal) = faults.cleanup_journal {
            *journal.fail_phase.lock().unwrap() = Some(Phase::Writing);
        }
        if faults.write {
            Err("No space left on device".into())
        } else {
            Ok(())
        }
    }
    async fn finish(&mut self) -> Result<(), String> {
        let faults = self.endpoint.faults.lock().unwrap().clone();
        if faults.close {
            Err("CLOSE acknowledgement lost".into())
        } else {
            self.endpoint.closed.store(true, Ordering::Relaxed);
            if faults.replace_on_close {
                self.endpoint.files.lock().unwrap().insert(
                    self.path.clone(),
                    b"foreign replacement, not our partial copy".to_vec(),
                );
            }
            Ok(())
        }
    }
}

#[async_trait]
impl FileEndpoint for FakeEndpoint {
    async fn stat(&self, path: &str) -> Result<Option<Snapshot>, String> {
        if path.starts_with("/.zync-transfer-")
            && self.closed.load(Ordering::Relaxed)
            && self.faults.lock().unwrap().stat_after_close
        {
            return Err("session closed during cleanup inspection".into());
        }
        Ok(self.bytes(path).map(|b| Snapshot {
            kind: EntryKind::File,
            size: b.len() as u64,
            modified: Some(1),
            mode: Some(0o644),
        }))
    }
    async fn canonicalize(&self, path: &str) -> Result<String, String> {
        if path == "/target" {
            if let Some(alias) = &self.faults.lock().unwrap().canonical_target {
                return Ok(alias.clone());
            }
        }
        Ok(path.into())
    }
    async fn reader(&self, path: &str) -> Result<Reader, String> {
        Ok(Box::new(std::io::Cursor::new(
            self.bytes(path).ok_or("Missing source")?,
        )))
    }
    async fn prepare_publish(&self, _: &str, _: bool) -> Result<(), String> {
        if self.faults.lock().unwrap().publish_preflight {
            Err("No safe publication primitive".into())
        } else {
            Ok(())
        }
    }
    async fn create_stage(&self, path: &str) -> Result<Box<dyn StageWriter>, String> {
        let mut files = self.files.lock().unwrap();
        if files.contains_key(path) {
            return Err("Stage already exists".into());
        }
        files.insert(path.into(), vec![]);
        Ok(Box::new(FakeWriter {
            endpoint: self.clone(),
            path: path.into(),
        }))
    }
    async fn set_mode(&self, _: &str, _: Option<u32>) -> Result<(), String> {
        if let Some(token) = &self.faults.lock().unwrap().cancel_on_mode {
            token.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
    async fn publish(&self, from: &str, to: &str, overwrite: bool) -> Result<(), String> {
        let faults = self.faults.lock().unwrap().clone();
        if faults.publish {
            return Err("Publish transport lost".into());
        }
        let mut files = self.files.lock().unwrap();
        if !overwrite && files.contains_key(to) {
            return Err("Target exists".into());
        }
        let content = files.remove(from).ok_or("Stage missing")?;
        files.insert(to.into(), content);
        if let Some(token) = faults.cancel_on_publish {
            token.store(true, Ordering::Relaxed);
        }
        if faults.lost_publish_ack {
            Err("Publish acknowledgement lost".into())
        } else {
            Ok(())
        }
    }
    async fn rename_absent(&self, from: &str, to: &str) -> Result<(), String> {
        if self.faults.lock().unwrap().backup {
            return Err("Backup acknowledgement lost".into());
        }
        let mut files = self.files.lock().unwrap();
        if files.contains_key(to) {
            return Err("Backup exists".into());
        }
        let content = files.remove(from).ok_or("Original missing")?;
        files.insert(to.into(), content);
        Ok(())
    }
    async fn remove(&self, path: &str) -> Result<(), String> {
        assert!(
            self.closed.load(Ordering::Relaxed),
            "Cleanup must wait for CLOSE acknowledgement"
        );
        if self.faults.lock().unwrap().cleanup {
            return Err("Backup cleanup denied".into());
        }
        self.files.lock().unwrap().remove(path);
        Ok(())
    }
    fn requires_backup(&self) -> bool {
        self.backup
    }
    fn sibling(&self, _: &str, name: &str) -> Result<String, String> {
        Ok(format!("/{name}"))
    }
    fn filename(&self, target: &str) -> Result<String, String> {
        Ok(target.rsplit('/').next().unwrap().into())
    }
    fn collision_key(&self, parent: &str, leaf: &str) -> String {
        if self.faults.lock().unwrap().colliding_names {
            "same-preflight-name".into()
        } else {
            self.reservation_key(parent, leaf)
        }
    }
}

#[tokio::test]
async fn tree_preflight_uses_collision_policy_without_changing_reservation_identity() {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("child"), b"content").unwrap();
    let plan = tree::Inventory::capture(
        &Endpoint::Local,
        directory.path().to_str().unwrap(),
        &Arc::new(AtomicBool::new(false)),
    )
    .await
    .unwrap();
    let endpoint = FakeEndpoint::new(false);
    let key = endpoint.reservation_key("/Target", "ReadMe");
    plan.validate_destination(&endpoint, "/Target").unwrap();
    endpoint.faults.lock().unwrap().colliding_names = true;
    assert!(plan
        .validate_destination(&endpoint, "/Target")
        .unwrap_err()
        .contains("names collide"));
    assert_eq!(endpoint.reservation_key("/Target", "ReadMe"), key);
    assert_ne!(
        endpoint.reservation_key("/Target", ""),
        endpoint.reservation_key("/Target/child", "")
    );
    assert!(
        endpoint.artifacts().is_empty(),
        "Collision preflight must not mutate the destination"
    );
}

#[tokio::test]
async fn existing_destination_aliases_cannot_bypass_source_overlap_preflight() {
    for alias in ["/source", "/"] {
        let directory = tempfile::tempdir().unwrap();
        let service = Service::new(directory.path().into());
        let endpoint = FakeEndpoint::new(false);
        endpoint.faults.lock().unwrap().canonical_target = Some(alias.into());
        let result = service
            .execute(
                request(true),
                Arc::new(endpoint.clone()),
                Arc::new(endpoint.clone()),
                Arc::new(AtomicBool::new(false)),
                |_, _| {},
            )
            .await;
        assert!(
            result.is_err(),
            "An existing destination alias must be checked before mutation: {result:?}"
        );
        assert!(endpoint.artifacts().is_empty());
        assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
        assert!(service.history().await.unwrap().is_empty());
    }
}

fn request(overwrite: bool) -> Request {
    Request {
        id: uuid::Uuid::new_v4().to_string(),
        source_connection_id: "source".into(),
        source_path: "/source".into(),
        source_identity: "fixture".into(),
        destination_connection_id: "destination".into(),
        destination_path: "/target".into(),
        destination_identity: "fixture".into(),
        overwrite,
        stage_copy: None,
    }
}

async fn execute(service: &Service, endpoint: &FakeEndpoint, token: Arc<AtomicBool>) -> Receipt {
    service
        .execute(
            request(true),
            Arc::new(endpoint.clone()),
            Arc::new(endpoint.clone()),
            token,
            |_, _| {},
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn restore_keeps_only_active_work_and_unresolved_recovery_without_mutating_journal() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(true);
    let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
    assert!(receipt.clone().for_restore(false).is_none());
    assert!(receipt.clone().for_restore(true).is_some());
    let mut cancelled = receipt.clone();
    cancelled.phase = Phase::Cancelled;
    cancelled.destination_unchanged = true;
    cancelled.stage_cleaned = true;
    assert!(cancelled.clone().for_restore(false).is_none());
    cancelled.warning = Some("Journal cleanup needs attention".into());
    assert!(cancelled.clone().for_restore(false).is_some());
    cancelled.warning = None;
    cancelled.stage_cleaned = false;
    assert!(cancelled.for_restore(false).is_some());
    for phase in [
        Phase::Prepared,
        Phase::Writing,
        Phase::Ready,
        Phase::BackingUp,
        Phase::Publishing,
        Phase::Published,
        Phase::Failed,
        Phase::NeedsReview,
    ] {
        let mut pending = receipt.clone();
        pending.phase = phase.clone();
        let live = pending.clone().for_restore(true).unwrap();
        assert_eq!(live.phase, phase);
        let restored = pending.for_restore(false).unwrap();
        assert!(matches!(restored.phase, Phase::Failed | Phase::NeedsReview));
    }
    let mut warned = receipt;
    warned.warning = Some("Backup retained".into());
    assert!(warned.for_restore(false).is_some());
    // Restore is a view policy, not deletion or a journal state transition.
    assert_eq!(service.history().await.unwrap()[0].phase, Phase::Completed);
    assert_eq!(endpoint.bytes("/target").unwrap(), b"new content");
}

#[tokio::test]
async fn unsupported_publication_fails_before_any_stage_or_publication_intent() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(false);
    endpoint.faults.lock().unwrap().publish_preflight = true;
    let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
    assert_eq!(receipt.phase, Phase::Failed);
    assert!(receipt.destination_unchanged);
    assert!(receipt
        .error
        .unwrap()
        .contains("No safe publication primitive"));
    assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
    assert!(endpoint.artifacts().is_empty());
}

#[tokio::test]
async fn local_publication_preflight_and_no_overwrite_preserve_existing_targets() {
    let dir = tempfile::tempdir().unwrap();
    let stage = dir.path().join("stage").to_string_lossy().into_owned();
    let target = dir.path().join("target").to_string_lossy().into_owned();
    Endpoint::Local
        .prepare_publish(&target, false)
        .await
        .unwrap();
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    std::fs::write(&stage, b"first").unwrap();
    Endpoint::Local
        .publish(&stage, &target, false)
        .await
        .unwrap();
    assert!(!PathBuf::from(&stage).exists());
    std::fs::write(&stage, b"second").unwrap();
    super::endpoint::prepare_local_publication(&target).unwrap();
    assert!(Endpoint::Local
        .publish(&stage, &target, false)
        .await
        .is_err());
    assert_eq!(std::fs::read(&target).unwrap(), b"first");
    assert_eq!(std::fs::read(&stage).unwrap(), b"second");
}

#[tokio::test]
async fn dismissed_recovery_has_separate_bounded_capacity_without_weakening_visible_limit() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(false);
    let mut receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
    receipt.phase = Phase::NeedsReview;
    for index in 0..256 {
        if index > 0 {
            receipt.id = uuid::Uuid::new_v4().to_string();
        }
        service.journal.save(&receipt).await.unwrap();
    }
    receipt.id = uuid::Uuid::new_v4().to_string();
    assert!(service
        .journal
        .save(&receipt)
        .await
        .unwrap_err()
        .contains("history is full"));
    for saved in service.history().await.unwrap() {
        service.dismiss(saved.id).await.unwrap();
    }
    for _ in 0..256 {
        receipt.id = uuid::Uuid::new_v4().to_string();
        service.journal.save(&receipt).await.unwrap();
    }
    let history = service.history().await.unwrap();
    assert_eq!(history.len(), 512);
    assert_eq!(history.iter().filter(|saved| saved.dismissed).count(), 256);
    assert_eq!(
        history
            .into_iter()
            .filter_map(|saved| saved.for_restore(false))
            .count(),
        256
    );
    receipt.id = uuid::Uuid::new_v4().to_string();
    receipt.dismissed = true;
    assert!(service
        .journal
        .save(&receipt)
        .await
        .unwrap_err()
        .contains("safety journal is full"));
    assert_eq!(service.history().await.unwrap().len(), 512);
}

#[tokio::test]
async fn staging_keeps_original_until_success_and_cleans_acknowledged_backup() {
    for backup in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(backup);
        let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
        assert_eq!(receipt.phase, Phase::Completed);
        assert!(receipt.warning.is_none());
        assert_eq!(endpoint.bytes("/target").unwrap(), b"new content");
        assert!(endpoint.artifacts().is_empty());
        assert_eq!(service.history().await.unwrap()[0].phase, Phase::Completed);
    }
}

#[tokio::test]
async fn disk_full_or_close_error_never_replaces_or_renames_original() {
    for close in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(true);
        if close {
            endpoint.faults.lock().unwrap().close = true;
        } else {
            endpoint.faults.lock().unwrap().write = true;
        }
        let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
        assert_eq!(receipt.phase, Phase::Failed);
        assert!(receipt.destination_unchanged);
        assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
        assert!(endpoint.bytes(&receipt.backup_path).is_none());
        assert!(endpoint.bytes(&receipt.stage_path).is_some());
    }
}

#[tokio::test]
async fn cancellation_is_confirmed_before_publish_but_not_an_undo_after_commit() {
    for late in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(true);
        let token = Arc::new(AtomicBool::new(false));
        if late {
            endpoint.faults.lock().unwrap().cancel_on_publish = Some(token.clone());
        } else {
            endpoint.faults.lock().unwrap().cancel_on_write = Some(token.clone());
        }
        let receipt = execute(&service, &endpoint, token).await;
        assert_eq!(
            receipt.phase,
            if late {
                Phase::Completed
            } else {
                Phase::Cancelled
            },
            "late cancellation: {late}"
        );
        assert_eq!(
            endpoint.bytes("/target").unwrap(),
            if late {
                b"new content".as_slice()
            } else {
                b"original"
            }
        );
        assert!(endpoint.artifacts().is_empty());
        assert_eq!(receipt.stage_cleaned, !late);
        assert!(receipt.warning.is_none());
    }
}

#[tokio::test]
async fn confirmed_cancellation_cleans_new_and_overwrite_staging_and_can_be_dismissed() {
    for (overwrite, backup) in [(true, true), (true, false), (false, false)] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(backup);
        if !overwrite {
            endpoint.files.lock().unwrap().remove("/target");
        }
        let token = Arc::new(AtomicBool::new(false));
        endpoint.faults.lock().unwrap().cancel_on_write = Some(token.clone());
        let receipt = service
            .execute(
                request(overwrite),
                Arc::new(endpoint.clone()),
                Arc::new(endpoint.clone()),
                token,
                |_, _| {},
            )
            .await
            .unwrap();
        assert_eq!(receipt.phase, Phase::Cancelled);
        assert!(receipt.stage_cleaned && receipt.destination_unchanged);
        assert!(receipt.warning.is_none() && endpoint.artifacts().is_empty());
        assert_eq!(
            endpoint.bytes("/target"),
            overwrite.then(|| b"original".to_vec())
        );
        assert!(service.history().await.unwrap()[0].stage_cleaned);
        service.dismiss(receipt.id).await.unwrap();
        assert!(service.history().await.unwrap().is_empty());
    }
}

#[tokio::test]
async fn cancellation_after_completed_staging_cleans_before_publication() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(true);
    let token = Arc::new(AtomicBool::new(false));
    endpoint.faults.lock().unwrap().cancel_on_mode = Some(token.clone());
    let receipt = execute(&service, &endpoint, token).await;
    assert_eq!(receipt.phase, Phase::Cancelled);
    assert!(receipt.stage_cleaned && endpoint.artifacts().is_empty());
    assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
}

#[tokio::test]
async fn cancelled_cleanup_failures_retain_artifacts_and_actionable_receipts() {
    for fault in ["delete", "changed", "stat", "journal", "close"] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(true);
        let token = Arc::new(AtomicBool::new(false));
        {
            let mut faults = endpoint.faults.lock().unwrap();
            faults.cancel_on_write = Some(token.clone());
            match fault {
                "delete" => faults.cleanup = true,
                "changed" => faults.replace_on_close = true,
                "stat" => faults.stat_after_close = true,
                "journal" => faults.cleanup_journal = Some(service.journal.clone()),
                "close" => faults.close = true,
                _ => unreachable!(),
            }
        }
        let receipt = execute(&service, &endpoint, token).await;
        assert_eq!(
            receipt.phase,
            if fault == "close" {
                Phase::Failed
            } else {
                Phase::Cancelled
            },
            "fault case: {fault}"
        );
        assert!(!receipt.stage_cleaned);
        assert!(receipt.warning.is_some());
        assert!(endpoint.bytes(&receipt.stage_path).is_some());
        assert!(endpoint.bytes(&receipt.backup_path).is_none());
        assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
        service.dismiss(receipt.id).await.unwrap();
        assert!(service.history().await.unwrap()[0].dismissed);
        if fault == "changed" {
            assert_eq!(
                endpoint.bytes(&receipt.stage_path).unwrap(),
                b"foreign replacement, not our partial copy"
            );
        }
    }
}

#[tokio::test]
async fn unknown_server_copy_is_not_cleaned_even_when_cancel_was_requested() {
    struct UnknownCopy(Arc<AtomicBool>);
    #[async_trait]
    impl StageCopy for UnknownCopy {
        async fn copy(&self, _: &str, _: &str) -> Result<bool, String> {
            self.0.store(true, Ordering::Relaxed);
            Err("Cancelled".into()) // Still an unknown exec, not the stream's cancellation signal.
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(true);
    let token = Arc::new(AtomicBool::new(false));
    let mut req = request(true);
    req.stage_copy = Some(Arc::new(UnknownCopy(token.clone())));
    let receipt = service
        .execute(
            req,
            Arc::new(endpoint.clone()),
            Arc::new(endpoint.clone()),
            token,
            |_, _| {},
        )
        .await
        .unwrap();
    assert_eq!(receipt.phase, Phase::Failed);
    assert!(!receipt.stage_cleaned && endpoint.bytes(&receipt.stage_path).is_some());
    assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
}

#[tokio::test]
async fn old_cancelled_receipts_allow_history_clear_without_implying_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(false);
    let mut receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
    receipt.phase = Phase::Cancelled;
    let mut serialized = serde_json::to_value(&receipt).unwrap();
    serialized.as_object_mut().unwrap().remove("stageCleaned");
    serialized.as_object_mut().unwrap().remove("dismissed");
    let old: Receipt = serde_json::from_value(serialized).unwrap();
    assert!(!old.stage_cleaned);
    assert!(!old.dismissed);
    service.journal.save(&old).await.unwrap();
    service.dismiss(old.id).await.unwrap();
    let saved = service.history().await.unwrap().remove(0);
    assert!(!saved.stage_cleaned && saved.dismissed);
    assert!(saved.for_restore(false).is_none());
}

async fn retained_closed_copy(service: &Service, endpoint: &FakeEndpoint) -> Receipt {
    let token = Arc::new(AtomicBool::new(false));
    {
        let mut faults = endpoint.faults.lock().unwrap();
        faults.cancel_on_write = Some(token.clone());
        faults.cleanup = true;
    }
    let receipt = execute(service, endpoint, token).await;
    assert_eq!(receipt.phase, Phase::Cancelled);
    assert!(receipt.staged.is_some());
    *endpoint.faults.lock().unwrap() = Faults::default();
    receipt
}

#[tokio::test]
async fn recovery_cleanup_after_restart_requires_closed_snapshot_and_explicit_request() {
    for backup in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(backup);
        let receipt = retained_closed_copy(&service, &endpoint).await;
        drop(service);
        let restarted = Service::new(dir.path().into());
        assert!(
            endpoint.bytes(&receipt.stage_path).is_some(),
            "Restart must not sweep artifacts"
        );
        let inspection = restarted
            .inspect_recovery(&receipt.id, &endpoint)
            .await
            .unwrap();
        assert!(inspection.cleanup_available && inspection.cleanup_blocked_reason.is_none());
        assert!(
            endpoint.bytes(&receipt.stage_path).is_some(),
            "Inspection must be read-only"
        );
        restarted
            .cleanup_recovery(&receipt.id, &endpoint)
            .await
            .unwrap();
        assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
        assert!(endpoint.artifacts().is_empty());
        assert!(restarted.history().await.unwrap().is_empty());
    }
}

#[tokio::test]
async fn recovery_cleanup_revalidates_changes_and_refuses_uncertain_or_publication_records() {
    for fault in [
        "unknown-writer",
        "publication",
        "backup",
        "target",
        "stage",
        "parent",
        "path",
        "entry-kind",
        "size",
        "delete",
        "stat",
    ] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(true);
        let mut receipt = retained_closed_copy(&service, &endpoint).await;
        match fault {
            "unknown-writer" => {
                receipt.phase = Phase::Writing;
                receipt.staged = None;
            }
            "publication" => {
                receipt.phase = Phase::Publishing;
                receipt.destination_unchanged = false;
            }
            "backup" => {
                endpoint
                    .files
                    .lock()
                    .unwrap()
                    .insert(receipt.backup_path.clone(), b"keep backup".to_vec());
            }
            "target" => {
                endpoint
                    .files
                    .lock()
                    .unwrap()
                    .insert("/target".into(), b"changed target".to_vec());
            }
            "stage" => {
                endpoint.files.lock().unwrap().insert(
                    receipt.stage_path.clone(),
                    b"changed temporary copy".to_vec(),
                );
            }
            "parent" => receipt.destination_key = "changed-parent".into(),
            "path" => receipt.backup_path = "/other-backup".into(),
            "entry-kind" => receipt.staged.as_mut().unwrap().kind = EntryKind::Symlink,
            "size" => receipt.transferred += 1,
            _ => {}
        }
        service.journal.save(&receipt).await.unwrap();
        // Transport/delete failures must retain the same evidence as refusals.
        if fault == "delete" {
            endpoint.faults.lock().unwrap().cleanup = true;
        }
        if fault == "stat" {
            endpoint.faults.lock().unwrap().stat_after_close = true;
        }
        let before = endpoint.files.lock().unwrap().clone();
        assert!(
            service
                .cleanup_recovery(&receipt.id, &endpoint)
                .await
                .is_err(),
            "{fault}"
        );
        assert_eq!(
            *endpoint.files.lock().unwrap(),
            before,
            "{fault}: do not delete any file"
        );
        assert_eq!(
            service.history().await.unwrap().len(),
            1,
            "{fault}: retain recovery evidence"
        );
    }
}

#[tokio::test]
async fn recovery_cleanup_refuses_destination_owned_by_a_live_job_or_other_recovery_action() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(false);
    let receipt = retained_closed_copy(&service, &endpoint).await;
    let lease = service
        .reserve_destination(receipt.destination_key.clone())
        .unwrap();
    assert!(service
        .cleanup_recovery(&receipt.id, &endpoint)
        .await
        .is_err());
    assert!(service
        .resolve_after_artifacts_removed(receipt.id.clone(), &endpoint)
        .await
        .is_err());
    assert!(endpoint.bytes(&receipt.stage_path).is_some());
    drop(lease);
    service
        .cleanup_recovery(&receipt.id, &endpoint)
        .await
        .unwrap();
}

#[tokio::test]
async fn recovery_cleanup_rechecks_after_inspection_and_does_not_delete_a_changed_entry() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(false);
    let receipt = retained_closed_copy(&service, &endpoint).await;
    assert!(
        service
            .inspect_recovery(&receipt.id, &endpoint)
            .await
            .unwrap()
            .cleanup_available
    );
    endpoint
        .files
        .lock()
        .unwrap()
        .insert(receipt.stage_path.clone(), b"foreign replacement".to_vec());
    assert!(service
        .cleanup_recovery(&receipt.id, &endpoint)
        .await
        .is_err());
    assert_eq!(
        endpoint.bytes(&receipt.stage_path).unwrap(),
        b"foreign replacement"
    );
    assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
}

#[tokio::test]
async fn real_local_cancel_closes_and_removes_only_its_stage() {
    for overwrite in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("source.bin");
        let target = dir.path().join("target.bin");
        std::fs::write(&source, vec![3u8; 512 * 1024]).unwrap();
        if overwrite {
            std::fs::write(&target, b"original").unwrap();
        }
        let service = Service::new(dir.path().join("history"));
        let token = Arc::new(AtomicBool::new(false));
        let mut req = request(overwrite);
        req.source_path = source.to_string_lossy().into_owned();
        req.destination_path = target.to_string_lossy().into_owned();
        req.destination_identity = "local".into();
        let receipt = service
            .execute(
                req,
                Arc::new(Endpoint::Local),
                Arc::new(Endpoint::Local),
                token.clone(),
                move |_, _| token.store(true, Ordering::Relaxed),
            )
            .await
            .unwrap();
        assert_eq!(receipt.phase, Phase::Cancelled);
        assert!(receipt.stage_cleaned && receipt.warning.is_none());
        assert!(!std::path::Path::new(&receipt.stage_path).exists());
        assert!(!std::path::Path::new(&receipt.backup_path).exists());
        assert_eq!(
            std::fs::read(&target).ok(),
            overwrite.then(|| b"original".to_vec())
        );
    }
}

#[tokio::test]
async fn uncertain_publication_never_replays_or_restores_and_blocks_another_write() {
    for lost_ack in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(true);
        if lost_ack {
            endpoint.faults.lock().unwrap().lost_publish_ack = true;
        } else {
            endpoint.faults.lock().unwrap().publish = true;
        }
        let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
        assert_eq!(receipt.phase, Phase::NeedsReview);
        assert_eq!(endpoint.bytes(&receipt.backup_path).unwrap(), b"original");
        service.dismiss(receipt.id.clone()).await.unwrap();
        drop(service);
        let service = Service::new(dir.path().into());
        let saved = service.history().await.unwrap().remove(0);
        assert!(saved.dismissed);
        assert!(saved.for_restore(false).is_none());
        assert_eq!(endpoint.bytes(&receipt.backup_path).unwrap(), b"original");
        assert_eq!(
            endpoint.bytes("/target"),
            if lost_ack {
                Some(b"new content".to_vec())
            } else {
                None
            }
        );
        let before = endpoint.artifacts();
        assert!(service
            .execute(
                request(true),
                Arc::new(endpoint.clone()),
                Arc::new(endpoint.clone()),
                Arc::new(AtomicBool::new(false)),
                |_, _| {}
            )
            .await
            .unwrap_err()
            .contains("interrupted publication"));
        assert_eq!(endpoint.artifacts(), before);
    }
}

#[tokio::test]
async fn cleanup_failure_is_success_with_protected_recovery_warning() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(true);
    endpoint.faults.lock().unwrap().cleanup = true;
    let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
    assert_eq!(receipt.phase, Phase::Completed);
    assert!(receipt.warning.unwrap().contains("cleanup denied"));
    service.dismiss(receipt.id).await.unwrap();
    assert!(service.history().await.unwrap()[0].dismissed);
    assert_eq!(endpoint.bytes("/target").unwrap(), b"new content");
}

#[tokio::test]
async fn restart_reads_journal_without_touching_or_deleting_any_artifact() {
    let dir = tempfile::tempdir().unwrap();
    let endpoint = FakeEndpoint::new(true);
    let receipt = {
        let service = Service::new(dir.path().into());
        endpoint.faults.lock().unwrap().lost_publish_ack = true;
        execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await
    };
    let before = endpoint.files.lock().unwrap().clone();
    let restarted = Service::new(dir.path().into());
    let history = restarted.history().await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].id, receipt.id);
    assert_eq!(history[0].phase, Phase::NeedsReview);
    assert_eq!(*endpoint.files.lock().unwrap(), before);
}

#[tokio::test]
async fn implicit_overwrite_and_reused_job_ids_are_rejected_before_mutation() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(false);
    assert!(service
        .execute(
            request(false),
            Arc::new(endpoint.clone()),
            Arc::new(endpoint.clone()),
            Arc::new(AtomicBool::new(false)),
            |_, _| {}
        )
        .await
        .is_err());
    assert!(endpoint.artifacts().is_empty());
    let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
    let mut reused = request(true);
    reused.id = receipt.id;
    assert!(service
        .execute(
            reused,
            Arc::new(endpoint.clone()),
            Arc::new(endpoint.clone()),
            Arc::new(AtomicBool::new(false)),
            |_, _| {}
        )
        .await
        .unwrap_err()
        .contains("already exists"));
}

#[tokio::test]
async fn corrupt_or_unwritable_journal_fails_closed_before_staging() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("file-transfers.redb"), b"not a database").unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(true);
    assert!(service
        .execute(
            request(true),
            Arc::new(endpoint.clone()),
            Arc::new(endpoint.clone()),
            Arc::new(AtomicBool::new(false)),
            |_, _| {}
        )
        .await
        .is_err());
    assert!(endpoint.artifacts().is_empty());
    assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
}

#[tokio::test]
async fn real_local_large_file_is_staged_then_published_with_bounded_buffers() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("source.bin");
    let target = dir.path().join("target.bin");
    let file = std::fs::File::create(&source).unwrap();
    file.set_len(200 * 1024 * 1024).unwrap();
    drop(file);
    std::fs::write(&target, b"old").unwrap();
    let service = Service::new(dir.path().join("history"));
    let mut request = request(true);
    request.source_connection_id = "local".into();
    request.destination_connection_id = "local".into();
    request.source_path = source.to_string_lossy().into();
    request.destination_path = target.to_string_lossy().into();
    let receipt = service
        .execute(
            request,
            Arc::new(Endpoint::Local),
            Arc::new(Endpoint::Local),
            Arc::new(AtomicBool::new(false)),
            |_, _| {},
        )
        .await
        .unwrap();
    assert_eq!(receipt.phase, Phase::Completed, "{receipt:?}");
    assert_eq!(std::fs::metadata(target).unwrap().len(), 200 * 1024 * 1024);
    assert!(!std::path::Path::new(&receipt.stage_path).exists());
}

struct FastCopy {
    endpoint: FakeEndpoint,
    outcome: Result<bool, String>,
}
#[async_trait]
impl StageCopy for FastCopy {
    async fn copy(&self, source: &str, stage: &str) -> Result<bool, String> {
        assert_eq!(self.endpoint.bytes("/target").unwrap(), b"original");
        assert!(
            self.endpoint.bytes(stage).is_some(),
            "Exclusive staging must precede server-side copy"
        );
        if self.outcome == Ok(true) {
            let data = self.endpoint.bytes(source).unwrap();
            self.endpoint
                .files
                .lock()
                .unwrap()
                .insert(stage.into(), data);
        }
        self.outcome.clone()
    }
}

#[tokio::test]
async fn server_side_acceleration_writes_only_staging_and_never_replays_uncertain_exec() {
    for outcome in [
        Ok(true),
        Ok(false),
        Err("SSH exec acknowledgement lost".to_string()),
    ] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(true);
        let mut request = request(true);
        request.stage_copy = Some(Arc::new(FastCopy {
            endpoint: endpoint.clone(),
            outcome: outcome.clone(),
        }));
        let receipt = service
            .execute(
                request,
                Arc::new(endpoint.clone()),
                Arc::new(endpoint.clone()),
                Arc::new(AtomicBool::new(false)),
                |_, _| {},
            )
            .await
            .unwrap();
        if outcome.is_err() {
            assert_eq!(receipt.phase, Phase::Failed);
            assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
            assert_eq!(
                endpoint.bytes(&receipt.stage_path).unwrap(),
                b"",
                "No streamed fallback after uncertain exec"
            );
        } else {
            assert_eq!(receipt.phase, Phase::Completed);
            assert_eq!(endpoint.bytes("/target").unwrap(), b"new content");
        }
    }
}

#[tokio::test]
async fn recovery_can_be_forgotten_only_after_artifacts_were_manually_resolved() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(true);
    endpoint.faults.lock().unwrap().publish = true;
    let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
    assert!(service
        .resolve_after_artifacts_removed(receipt.id.clone(), &endpoint)
        .await
        .is_err());
    assert_eq!(endpoint.bytes(&receipt.backup_path).unwrap(), b"original");
    // Simulate the user's separately reviewed recovery, not automatic engine cleanup.
    endpoint.files.lock().unwrap().remove(&receipt.stage_path);
    let original = endpoint
        .files
        .lock()
        .unwrap()
        .remove(&receipt.backup_path)
        .unwrap();
    endpoint
        .files
        .lock()
        .unwrap()
        .insert("/target".into(), original);
    service
        .resolve_after_artifacts_removed(receipt.id, &endpoint)
        .await
        .unwrap();
    assert!(service.history().await.unwrap().is_empty());
    assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
}

#[tokio::test]
async fn successful_history_is_bounded_without_expiring_unresolved_records() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(false);
    let mut receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
    let unresolved_id = uuid::Uuid::new_v4().to_string();
    receipt.id = unresolved_id.clone();
    receipt.phase = Phase::NeedsReview;
    service.journal.save(&receipt).await.unwrap();
    receipt.phase = Phase::Completed;
    for number in 0..25 {
        receipt.id = uuid::Uuid::new_v4().to_string();
        receipt.created_at = number;
        service.journal.save(&receipt).await.unwrap();
    }
    let history = service.history().await.unwrap();
    assert!(
        history
            .iter()
            .filter(|r| r.phase == Phase::Completed)
            .count()
            <= 20
    );
    assert!(history.iter().any(|r| r.id == unresolved_id));
}

#[tokio::test]
async fn local_staging_is_exclusive_and_never_truncates_an_existing_artifact() {
    let dir = tempfile::tempdir().unwrap();
    let stage = dir.path().join("stage.part").to_string_lossy().into_owned();
    std::fs::write(&stage, b"unrelated").unwrap();
    assert!(Endpoint::Local.create_stage(&stage).await.is_err());
    assert_eq!(std::fs::read(stage).unwrap(), b"unrelated");
}

#[tokio::test]
async fn journal_failure_before_a_mutation_never_authorizes_that_mutation() {
    for phase in [
        Phase::Writing,
        Phase::Ready,
        Phase::BackingUp,
        Phase::Publishing,
        Phase::Published,
        Phase::Completed,
    ] {
        let dir = tempfile::tempdir().unwrap();
        let service = Service::new(dir.path().into());
        let endpoint = FakeEndpoint::new(true);
        *service.journal.fail_phase.lock().unwrap() = Some(phase.clone());
        let receipt = execute(&service, &endpoint, Arc::new(AtomicBool::new(false))).await;
        match phase {
            Phase::Writing | Phase::Ready | Phase::BackingUp => {
                assert_eq!(receipt.phase, Phase::Failed);
                assert!(receipt.destination_unchanged);
                assert_eq!(endpoint.bytes("/target").unwrap(), b"original");
                assert!(endpoint.bytes(&receipt.backup_path).is_none());
            }
            Phase::Publishing => {
                assert_eq!(receipt.phase, Phase::NeedsReview);
                assert!(endpoint.bytes("/target").is_none());
                assert_eq!(endpoint.bytes(&receipt.backup_path).unwrap(), b"original");
            }
            Phase::Published | Phase::Completed => {
                assert_eq!(receipt.phase, Phase::NeedsReview);
                assert_eq!(endpoint.bytes("/target").unwrap(), b"new content");
            }
            _ => unreachable!(),
        }
    }
}

#[tokio::test]
async fn native_admission_is_bounded_and_releases_destination_on_failure() {
    let dir = tempfile::tempdir().unwrap();
    let service = Service::new(dir.path().into());
    let endpoint = FakeEndpoint::new(false);
    let permits = service
        .capacity
        .clone()
        .acquire_many_owned(MAX_ADMITTED as u32)
        .await
        .unwrap();
    let result = service
        .execute(
            request(true),
            Arc::new(endpoint.clone()),
            Arc::new(endpoint.clone()),
            Arc::new(AtomicBool::new(false)),
            |_, _| {},
        )
        .await;
    assert!(result.unwrap_err().contains("queue is full"));
    assert!(endpoint.artifacts().is_empty());
    drop(permits);
    endpoint.faults.lock().unwrap().write = true;
    assert_eq!(
        execute(&service, &endpoint, Arc::new(AtomicBool::new(false)))
            .await
            .phase,
        Phase::Failed
    );
    assert!(service.destinations.lock().unwrap().is_empty());
    endpoint.faults.lock().unwrap().write = false;
    assert_eq!(
        execute(&service, &endpoint, Arc::new(AtomicBool::new(false)))
            .await
            .phase,
        Phase::Completed
    );
}

#[tokio::test]
async fn queued_cancellation_wakes_without_waiting_for_a_large_active_transfer() {
    let dir = tempfile::tempdir().unwrap();
    let service = Arc::new(Service::new(dir.path().into()));
    let endpoint = Arc::new(FakeEndpoint::new(false));
    let permits = service
        .admission
        .clone()
        .acquire_many_owned(MAX_ACTIVE as u32)
        .await
        .unwrap();
    let request = request(true);
    let id = request.id.clone();
    let token = Arc::new(AtomicBool::new(false));
    let task_token = token.clone();
    let worker_service = service.clone();
    let worker_endpoint = endpoint.clone();
    let waiting = tokio::spawn(async move {
        worker_service
            .execute(
                request,
                worker_endpoint.clone(),
                worker_endpoint,
                task_token,
                |_, _| {},
            )
            .await
    });
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !service.waiting.lock().unwrap().contains_key(&id) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    token.store(true, Ordering::Relaxed);
    service.wake_cancelled(&id);
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), waiting)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result.unwrap_err(), "Cancelled");
    assert!(endpoint.artifacts().is_empty());
    assert!(service.waiting.lock().unwrap().is_empty());
    assert_eq!(service.capacity.available_permits(), MAX_ADMITTED);
    drop(permits);
}
#[test]
fn progress_clock_spans_small_file_updates_and_rate_limits_accelerated_bursts() {
    let start = std::time::Instant::now();
    let mut last = start;
    for (milliseconds, expected) in [
        (10, false),
        (60, false),
        (100, true),
        (100, false),
        (110, false),
        (199, false),
        (200, true),
    ] {
        assert_eq!(
            super::progress_due(
                &mut last,
                start + std::time::Duration::from_millis(milliseconds)
            ),
            expected,
            "update at {milliseconds}ms"
        );
    }
}
