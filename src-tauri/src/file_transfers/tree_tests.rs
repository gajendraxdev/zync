//! Real directory trees with faults only at the existing endpoint boundary.
use super::{
    endpoint::{Endpoint, FileEndpoint, Reader, Snapshot, StageWriter},
    *,
};
use async_trait::async_trait;
use std::{path::Path, sync::atomic::Ordering};

#[derive(Default, Clone)]
struct Faults {
    write: bool,
    close: bool,
    publish: bool,
    lost_ack: bool,
    cleanup: bool,
    changed_child: bool,
    changed_source: bool,
    cancel_before_create: bool,
    cancel: Option<Arc<AtomicBool>>,
    cleanup_attempts: Option<Arc<std::sync::atomic::AtomicUsize>>,
    stage_verification_count: Option<Arc<std::sync::atomic::AtomicUsize>>,
}

struct Destination {
    original: PathBuf,
    faults: Faults,
}

struct Writer {
    inner: Box<dyn StageWriter>,
    original: PathBuf,
    faults: Faults,
}

#[async_trait]
impl StageWriter for Writer {
    async fn write(&mut self, bytes: &[u8]) -> Result<(), String> {
        assert!(
            self.original.join("old-only.txt").is_file(),
            "Original must stay available throughout copying"
        );
        if self.faults.changed_child {
            std::fs::write(
                self.original.join("old-only.txt"),
                b"changed nested original content",
            )
            .unwrap();
        }
        if self.faults.write {
            self.inner.write(&bytes[..bytes.len().min(3)]).await?;
            return Err("No space left on device".into());
        }
        self.inner.write(bytes).await?;
        if let Some(token) = &self.faults.cancel {
            token.store(true, Ordering::Relaxed);
        }
        Ok(())
    }
    async fn finish(&mut self) -> Result<(), String> {
        self.inner.finish().await?;
        if self.faults.changed_source {
            std::fs::write(
                self.original
                    .parent()
                    .unwrap()
                    .join("source/nested/content.txt"),
                b"changed after copying",
            )
            .unwrap();
        }
        if self.faults.close {
            Err("CLOSE acknowledgement lost".into())
        } else {
            Ok(())
        }
    }
}

#[async_trait]
impl FileEndpoint for Destination {
    async fn stat(&self, path: &str) -> Result<Option<Snapshot>, String> {
        Endpoint::Local.stat(path).await
    }
    async fn canonicalize(&self, path: &str) -> Result<String, String> {
        Endpoint::Local.canonicalize(path).await
    }
    async fn reader(&self, path: &str) -> Result<Reader, String> {
        Endpoint::Local.reader(path).await
    }
    async fn create_stage(&self, path: &str) -> Result<Box<dyn StageWriter>, String> {
        Ok(Box::new(Writer {
            inner: Endpoint::Local.create_stage(path).await?,
            original: self.original.clone(),
            faults: self.faults.clone(),
        }))
    }
    async fn set_mode(&self, path: &str, mode: Option<u32>) -> Result<(), String> {
        Endpoint::Local.set_mode(path, mode).await
    }
    async fn publish(&self, from: &str, to: &str, overwrite: bool) -> Result<(), String> {
        if self.faults.publish {
            return Err("Publication transport lost".into());
        }
        Endpoint::Local.publish(from, to, overwrite).await?;
        if self.faults.lost_ack {
            Err("Publication acknowledgement lost".into())
        } else {
            Ok(())
        }
    }
    async fn rename_absent(&self, from: &str, to: &str) -> Result<(), String> {
        Endpoint::Local.rename_absent(from, to).await
    }
    async fn remove(&self, path: &str) -> Result<(), String> {
        if let Some(count) = &self.faults.cleanup_attempts {
            count.fetch_add(1, Ordering::Relaxed);
        }
        if self.faults.cleanup {
            Err("Cleanup denied".into())
        } else {
            Endpoint::Local.remove(path).await
        }
    }
    async fn children(&self, path: &str) -> Result<Vec<(String, Option<Snapshot>)>, String> {
        if Path::new(path)
            .file_name()
            .is_some_and(|name| name.to_string_lossy().ends_with(".part"))
        {
            if let Some(count) = &self.faults.stage_verification_count {
                if count.fetch_add(1, Ordering::Relaxed) == 1 {
                    std::fs::write(
                        self.original.join("old-only.txt"),
                        b"changed during staged-tree verification",
                    )
                    .unwrap();
                }
            }
        }
        Endpoint::Local.children(path).await
    }
    async fn create_directory(&self, path: &str) -> Result<(), String> {
        Endpoint::Local.create_directory(path).await
    }
    async fn remove_directory(&self, path: &str) -> Result<(), String> {
        if let Some(count) = &self.faults.cleanup_attempts {
            count.fetch_add(1, Ordering::Relaxed);
        }
        if self.faults.cleanup {
            Err("Cleanup denied".into())
        } else {
            Endpoint::Local.remove_directory(path).await
        }
    }
    async fn prepare_directory_publish(&self, path: &str) -> Result<(), String> {
        Endpoint::Local.prepare_directory_publish(path).await?;
        if self.faults.cancel_before_create {
            self.faults
                .cancel
                .as_ref()
                .unwrap()
                .store(true, Ordering::Relaxed);
        }
        Ok(())
    }
    async fn read_link(&self, path: &str) -> Result<String, String> {
        Endpoint::Local.read_link(path).await
    }
    async fn create_link(&self, path: &str, target: &str, directory: bool) -> Result<(), String> {
        Endpoint::Local.create_link(path, target, directory).await
    }
    fn requires_backup(&self) -> bool {
        false
    }
    fn sibling(&self, target: &str, name: &str) -> Result<String, String> {
        Endpoint::Local.sibling(target, name)
    }
    fn filename(&self, path: &str) -> Result<String, String> {
        Endpoint::Local.filename(path)
    }
    fn child(&self, parent: &str, name: &str) -> Result<String, String> {
        Endpoint::Local.child(parent, name)
    }
    fn reservation_key(&self, parent: &str, name: &str) -> String {
        Endpoint::Local.reservation_key(parent, name)
    }
}

fn fixture() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    std::fs::create_dir_all(root.join("source/nested/empty")).unwrap();
    std::fs::write(root.join("source/nested/content.txt"), b"new content").unwrap();
    std::fs::write(root.join("source/zero"), []).unwrap();
    std::fs::create_dir(root.join("target")).unwrap();
    std::fs::write(root.join("target/old-only.txt"), b"original").unwrap();
    directory
}

fn request(root: &Path, overwrite: bool) -> Request {
    Request {
        id: uuid::Uuid::new_v4().to_string(),
        source_connection_id: "local".into(),
        source_identity: "local".into(),
        source_path: root.join("source").to_str().unwrap().into(),
        destination_connection_id: "local".into(),
        destination_identity: "local".into(),
        destination_path: root.join("target").to_str().unwrap().into(),
        overwrite,
        stage_copy: None,
    }
}

async fn run(root: &Path, faults: Faults, token: Arc<AtomicBool>) -> Receipt {
    Service::new(root.join("history"))
        .execute(
            request(root, true),
            Arc::new(Endpoint::Local),
            Arc::new(Destination {
                original: root.join("target"),
                faults,
            }),
            token,
            |_, _| {},
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn folder_replacement_keeps_original_during_copy_and_publishes_complete_tree() {
    let directory = fixture();
    let receipt = run(
        directory.path(),
        Faults::default(),
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    assert_eq!(receipt.phase, Phase::Completed, "{receipt:?}");
    assert_eq!(
        std::fs::read(directory.path().join("target/nested/content.txt")).unwrap(),
        b"new content"
    );
    assert!(directory.path().join("target/nested/empty").is_dir());
    assert!(directory.path().join("target/zero").is_file());
    assert!(
        !directory.path().join("target/old-only.txt").exists(),
        "Replacement must not silently merge"
    );
    assert!(!Path::new(&receipt.stage_path).exists());
    assert!(!Path::new(&receipt.backup_path).exists());
    assert!(receipt.warning.is_none());
    assert_eq!(receipt.total, 11);
    assert_eq!(receipt.transferred, receipt.total);
}

#[tokio::test]
async fn new_and_empty_folders_use_the_same_staging_service() {
    for empty in [false, true] {
        let directory = fixture();
        let mut operation = request(directory.path(), false);
        operation.destination_path = directory.path().join("new-target").to_str().unwrap().into();
        if empty {
            operation.source_path = directory
                .path()
                .join("source/nested/empty")
                .to_str()
                .unwrap()
                .into();
        }
        let receipt = Service::new(directory.path().join("history"))
            .execute(
                operation,
                Arc::new(Endpoint::Local),
                Arc::new(Endpoint::Local),
                Arc::new(AtomicBool::new(false)),
                |_, _| {},
            )
            .await
            .unwrap();
        assert_eq!(receipt.phase, Phase::Completed, "{receipt:?}");
        assert!(directory.path().join("new-target").is_dir());
        assert!(!Path::new(&receipt.stage_path).exists());
    }
}

#[tokio::test]
async fn folder_cancel_closes_writers_then_removes_only_its_temporary_tree() {
    let directory = fixture();
    let token = Arc::new(AtomicBool::new(false));
    let receipt = run(
        directory.path(),
        Faults {
            cancel: Some(token.clone()),
            ..Default::default()
        },
        token,
    )
    .await;
    assert_eq!(receipt.phase, Phase::Cancelled, "{receipt:?}");
    assert!(receipt.stage_cleaned && receipt.destination_unchanged);
    assert_eq!(
        std::fs::read(directory.path().join("target/old-only.txt")).unwrap(),
        b"original"
    );
    assert!(!Path::new(&receipt.stage_path).exists());
    assert!(!Path::new(&receipt.backup_path).exists());
}

#[tokio::test]
async fn folder_cancel_before_first_create_does_not_leave_false_recovery_work() {
    let directory = fixture();
    let token = Arc::new(AtomicBool::new(false));
    let receipt = run(
        directory.path(),
        Faults {
            cancel_before_create: true,
            cancel: Some(token.clone()),
            ..Default::default()
        },
        token,
    )
    .await;
    assert_eq!(receipt.phase, Phase::Cancelled, "{receipt:?}");
    assert!(receipt.stage_cleaned && receipt.warning.is_none());
    assert!(!Path::new(&receipt.stage_path).exists());
}

#[tokio::test]
async fn folder_cancellation_cleanup_has_one_outcome_owner_and_no_implicit_retry() {
    let directory = fixture();
    let token = Arc::new(AtomicBool::new(false));
    let count = Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let receipt = run(
        directory.path(),
        Faults {
            cleanup: true,
            cancel: Some(token.clone()),
            cleanup_attempts: Some(count.clone()),
            ..Default::default()
        },
        token,
    )
    .await;
    assert_eq!(receipt.phase, Phase::Cancelled, "{receipt:?}");
    assert_eq!(
        count.load(Ordering::Relaxed),
        1,
        "A failed cleanup must not be replayed by another outcome handler"
    );
    assert!(receipt.warning.unwrap().contains("Cleanup denied"));
    assert!(Path::new(&receipt.stage_path).is_dir());
}

#[tokio::test]
async fn cancellation_with_unknown_close_retains_folder_without_cleanup_authority() {
    let directory = fixture();
    let token = Arc::new(AtomicBool::new(false));
    let receipt = run(
        directory.path(),
        Faults {
            close: true,
            cancel: Some(token.clone()),
            ..Default::default()
        },
        token,
    )
    .await;
    assert_eq!(receipt.phase, Phase::Failed, "{receipt:?}");
    assert!(
        receipt.destination_unchanged && !receipt.stage_cleaned && receipt.staged_tree.is_none()
    );
    assert!(Path::new(&receipt.stage_path).exists());
    assert!(directory.path().join("target/old-only.txt").exists());
    let service = Service::new(directory.path().join("history"));
    assert!(
        !service
            .inspect_recovery(&receipt.id, &Endpoint::Local)
            .await
            .unwrap()
            .cleanup_available
    );
}

#[tokio::test]
async fn storage_failure_and_unknown_close_never_publish_partial_folders() {
    for faults in [
        Faults {
            write: true,
            ..Default::default()
        },
        Faults {
            close: true,
            ..Default::default()
        },
    ] {
        let directory = fixture();
        let receipt = run(
            directory.path(),
            faults.clone(),
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        assert_eq!(receipt.phase, Phase::Failed, "{receipt:?}");
        assert!(receipt.destination_unchanged && !receipt.stage_cleaned);
        assert_eq!(
            std::fs::read(directory.path().join("target/old-only.txt")).unwrap(),
            b"original"
        );
        assert!(!Path::new(&receipt.backup_path).exists());
        assert!(Path::new(&receipt.stage_path).is_dir());
        assert_eq!(
            receipt.staged_tree.is_none(),
            faults.close,
            "Only acknowledged closed writers permit cleanup"
        );
    }
}

#[tokio::test]
async fn folder_publication_unknown_outcome_retains_stage_or_published_tree_and_original_backup() {
    for lost_ack in [false, true] {
        let directory = fixture();
        let receipt = run(
            directory.path(),
            Faults {
                publish: !lost_ack,
                lost_ack,
                ..Default::default()
            },
            Arc::new(AtomicBool::new(false)),
        )
        .await;
        assert_eq!(receipt.phase, Phase::NeedsReview, "{receipt:?}");
        assert!(!receipt.destination_unchanged);
        assert_eq!(
            std::fs::read(Path::new(&receipt.backup_path).join("old-only.txt")).unwrap(),
            b"original"
        );
        assert_eq!(Path::new(&receipt.stage_path).exists(), !lost_ack);
        assert_eq!(
            directory.path().join("target/nested/content.txt").exists(),
            lost_ack
        );
        let service = Service::new(directory.path().join("history"));
        assert!(
            !service
                .inspect_recovery(&receipt.id, &Endpoint::Local)
                .await
                .unwrap()
                .cleanup_available
        );
        service.dismiss(receipt.id.clone()).await.unwrap();
        assert!(service.history().await.unwrap()[0]
            .clone()
            .for_restore(false)
            .is_none());
        assert!(
            Path::new(&receipt.backup_path).is_dir(),
            "Clearing history must never delete recovery data"
        );
    }
}

#[tokio::test]
async fn changed_nested_destination_and_backup_cleanup_failure_are_not_hidden() {
    let directory = fixture();
    let receipt = run(
        directory.path(),
        Faults {
            changed_child: true,
            ..Default::default()
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    assert_eq!(receipt.phase, Phase::Failed, "{receipt:?}");
    assert!(
        receipt.destination_unchanged
            && receipt
                .error
                .unwrap()
                .contains("Destination folder changed")
    );
    assert!(!Path::new(&receipt.backup_path).exists());
    let directory = fixture();
    let receipt = run(
        directory.path(),
        Faults {
            cleanup: true,
            ..Default::default()
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    assert_eq!(receipt.phase, Phase::Completed);
    assert!(receipt.warning.unwrap().contains("backup cleanup failed"));
    assert!(Path::new(&receipt.backup_path)
        .join("old-only.txt")
        .is_file());
}

#[tokio::test]
async fn source_child_change_after_copy_prevents_folder_publication() {
    let directory = fixture();
    let receipt = run(
        directory.path(),
        Faults {
            changed_source: true,
            ..Default::default()
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    assert_eq!(receipt.phase, Phase::Failed, "{receipt:?}");
    assert!(
        receipt.destination_unchanged && receipt.error.unwrap().contains("Source folder changed")
    );
    assert!(!Path::new(&receipt.backup_path).exists());
    assert_eq!(
        std::fs::read(directory.path().join("target/old-only.txt")).unwrap(),
        b"original"
    );
}

#[tokio::test]
async fn original_tree_is_checked_after_the_potentially_long_staging_verification() {
    let directory = fixture();
    let receipt = run(
        directory.path(),
        Faults {
            stage_verification_count: Some(Arc::new(std::sync::atomic::AtomicUsize::new(0))),
            ..Default::default()
        },
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    assert_eq!(receipt.phase, Phase::Failed, "{receipt:?}");
    assert!(receipt.destination_unchanged);
    assert!(receipt
        .error
        .unwrap()
        .contains("Destination folder changed"));
    assert!(!Path::new(&receipt.backup_path).exists());
    assert_eq!(
        std::fs::read(directory.path().join("target/old-only.txt")).unwrap(),
        b"changed during staged-tree verification"
    );
}

#[cfg(windows)]
#[test]
fn windows_folder_names_reject_all_documented_reserved_device_suffixes_and_controls() {
    for name in [
        "CON",
        "nul.txt",
        "COM1",
        "COM¹",
        "COM².log",
        "COM³",
        "LPT¹",
        "lpt².txt",
        "LPT³",
        "bad\u{1f}name",
        "bad\nname",
    ] {
        assert!(
            Endpoint::Local.child("C:/fixture", name).is_err(),
            "Unsafe Windows leaf must fail preflight: {name:?}"
        );
    }
    for name in ["COM10", "LPT0", "node_modules", ".config", "café.txt"] {
        assert!(
            Endpoint::Local.child("C:/fixture", name).is_ok(),
            "Ordinary name must remain valid: {name}"
        );
    }
}

#[tokio::test]
async fn recovery_keeps_staging_when_original_nested_content_changed() {
    let directory = fixture();
    let token = Arc::new(AtomicBool::new(false));
    let receipt = run(
        directory.path(),
        Faults {
            cleanup: true,
            cancel: Some(token.clone()),
            ..Default::default()
        },
        token,
    )
    .await;
    let service = Service::new(directory.path().join("history"));
    assert!(
        service
            .inspect_recovery(&receipt.id, &Endpoint::Local)
            .await
            .unwrap()
            .cleanup_available
    );
    std::fs::write(
        directory.path().join("target/old-only.txt"),
        b"modified original child",
    )
    .unwrap();
    assert!(
        !service
            .inspect_recovery(&receipt.id, &Endpoint::Local)
            .await
            .unwrap()
            .cleanup_available
    );
    assert!(service
        .cleanup_recovery(&receipt.id, &Endpoint::Local)
        .await
        .is_err());
    assert!(Path::new(&receipt.stage_path).is_dir());
}

#[tokio::test]
async fn closed_cancelled_folder_recovery_rechecks_nested_entries_before_cleanup() {
    let directory = fixture();
    let token = Arc::new(AtomicBool::new(false));
    let receipt = run(
        directory.path(),
        Faults {
            cleanup: true,
            cancel: Some(token.clone()),
            ..Default::default()
        },
        token,
    )
    .await;
    assert_eq!(receipt.phase, Phase::Cancelled, "{receipt:?}");
    assert!(!receipt.stage_cleaned && receipt.staged_tree.is_some());
    let service = Service::new(directory.path().join("history"));
    assert!(
        service
            .inspect_recovery(&receipt.id, &Endpoint::Local)
            .await
            .unwrap()
            .cleanup_available
    );
    let leaf = Path::new(&receipt.stage_path).join("nested/content.txt");
    let bytes = std::fs::read(&leaf).unwrap();
    std::fs::write(&leaf, b"foreign changed contents").unwrap();
    assert!(
        !service
            .inspect_recovery(&receipt.id, &Endpoint::Local)
            .await
            .unwrap()
            .cleanup_available
    );
    assert!(service
        .cleanup_recovery(&receipt.id, &Endpoint::Local)
        .await
        .is_err());
    // Restoring bytes alone cannot restore recorded mtime; a new fixture proves
    // successful explicit cleanup separately rather than forging ownership here.
    assert_ne!(std::fs::read(&leaf).unwrap(), bytes);
    assert!(directory.path().join("target/old-only.txt").exists());
}

#[tokio::test]
async fn closed_folder_cleanup_reuses_recovery_action_after_restart() {
    let directory = fixture();
    let token = Arc::new(AtomicBool::new(false));
    let receipt = run(
        directory.path(),
        Faults {
            cleanup: true,
            cancel: Some(token.clone()),
            ..Default::default()
        },
        token,
    )
    .await;
    let service = Service::new(directory.path().join("history"));
    service
        .cleanup_recovery(&receipt.id, &Endpoint::Local)
        .await
        .unwrap();
    assert!(!Path::new(&receipt.stage_path).exists());
    assert!(service.history().await.unwrap().is_empty());
    assert!(directory.path().join("target/old-only.txt").exists());
}

#[tokio::test]
async fn folder_overlap_and_ancestor_leases_fail_before_mutation() {
    let directory = fixture();
    let service = Service::new(directory.path().join("history"));
    let mut operation = request(directory.path(), true);
    operation.destination_path = directory
        .path()
        .join("source/nested/recursive")
        .to_str()
        .unwrap()
        .into();
    let error = service
        .execute(
            operation,
            Arc::new(Endpoint::Local),
            Arc::new(Endpoint::Local),
            Arc::new(AtomicBool::new(false)),
            |_, _| {},
        )
        .await
        .unwrap_err();
    assert!(error.contains("overlap"), "{error}");
    assert!(service.history().await.unwrap().is_empty());
    let _parent = service.reserve_destination("host:/folder".into()).unwrap();
    assert!(service
        .reserve_destination("host:/folder/child".into())
        .is_err());
    assert!(service.reserve_destination("host:/".into()).is_err());
    assert!(service
        .reserve_destination("host:/folder-other".into())
        .is_ok());
}

#[tokio::test]
async fn folder_no_clobber_and_type_mismatch_are_rejected_before_staging() {
    let directory = fixture();
    let service = Service::new(directory.path().join("history"));
    for regular_destination in [false, true] {
        let mut operation = request(directory.path(), false);
        if regular_destination {
            operation.overwrite = true;
            operation.destination_path = directory
                .path()
                .join("target/old-only.txt")
                .to_str()
                .unwrap()
                .into();
        }
        assert!(service
            .execute(
                operation,
                Arc::new(Endpoint::Local),
                Arc::new(Endpoint::Local),
                Arc::new(AtomicBool::new(false)),
                |_, _| {}
            )
            .await
            .is_err());
    }
    assert!(service.history().await.unwrap().is_empty());
    assert_eq!(
        std::fs::read(directory.path().join("target/old-only.txt")).unwrap(),
        b"original"
    );
}

#[test]
fn canonical_destination_keys_preserve_old_windows_history_and_posix_names() {
    assert!(destination_keys_overlap(
        "host:/folder",
        "host:/folder/file"
    ));
    assert!(!destination_keys_overlap(
        "host:/folder",
        "other:/folder/file"
    ));
    assert!(!destination_keys_overlap(
        "host:/folder",
        "host:/folder-suffix"
    ));
    assert!(!destination_keys_overlap(
        "host:/literal\\name",
        "host:/literal/name"
    ));
    #[cfg(windows)]
    assert!(destination_keys_overlap(
        "local:c:\\parent/target",
        "local:c:/parent/target/child"
    ));
}

#[test]
fn collision_keys_default_to_reservation_keys_and_only_local_macos_folds_extra_case() {
    // This file-only wrapper deliberately inherits the trait default hook.
    let default_endpoint = Destination {
        original: PathBuf::new(),
        faults: Faults::default(),
    };
    for (parent, leaf) in [
        ("/Target", "ReadMe"),
        ("/Target", "ÉTÉ.txt"),
        ("/Target", "literal\\name"),
    ] {
        assert_eq!(
            default_endpoint.collision_key(parent, leaf),
            default_endpoint.reservation_key(parent, leaf)
        );
        let reserved = Endpoint::Local.reservation_key(parent, leaf);
        let collision = Endpoint::Local.collision_key(parent, leaf);
        if cfg!(target_os = "macos") {
            assert_eq!(
                reserved,
                format!("{parent}/{leaf}"),
                "Persisted macOS identity must stay byte-exact"
            );
            assert_eq!(collision, reserved.to_lowercase());
            assert_eq!(
                collision,
                Endpoint::Local.collision_key(parent, &leaf.to_lowercase())
            );
        } else {
            assert_eq!(
                collision, reserved,
                "Other local platforms retain their existing policy"
            );
        }
    }
}

#[tokio::test]
async fn remote_links_send_target_then_staging_path_in_openssh_wire_order() {
    use russh_sftp::{
        client::SftpSession,
        protocol::{Status, StatusCode},
    };
    struct LinkServer(Arc<Mutex<Vec<(String, String)>>>);
    impl russh_sftp::server::Handler for LinkServer {
        type Error = StatusCode;
        fn unimplemented(&self) -> StatusCode {
            StatusCode::OpUnsupported
        }
        async fn symlink(
            &mut self,
            id: u32,
            first: String,
            second: String,
        ) -> Result<Status, StatusCode> {
            self.0.lock().unwrap().push((first, second));
            Ok(Status {
                id,
                status_code: StatusCode::Ok,
                error_message: String::new(),
                language_tag: String::new(),
            })
        }
    }
    tokio::time::timeout(std::time::Duration::from_secs(20), async {
        // Capture the actual protocol fields without creating any filesystem link.
        let observed = Arc::new(Mutex::new(Vec::new()));
        let (client, server) = tokio::io::duplex(4096);
        let task = tokio::spawn(russh_sftp::server::run(
            server,
            LinkServer(observed.clone()),
        ));
        let session = Arc::new(SftpSession::new(client).await.unwrap());
        let endpoint = Endpoint::Remote(session.clone());
        let path = "/destination/.zync-transfer-fixture.part/link";
        for target in ["../outside/missing", "/absolute/missing"] {
            endpoint.create_link(path, target, false).await.unwrap();
        }
        session.close().await.unwrap();
        task.await.unwrap();
        assert_eq!(
            *observed.lock().unwrap(),
            vec![
                ("../outside/missing".to_owned(), path.to_owned()),
                ("/absolute/missing".to_owned(), path.to_owned()),
            ],
            "OpenSSH expects target first, then the new link inside staging"
        );
    })
    .await
    .expect("SFTP link contract must finish within the fixture deadline");
}

#[tokio::test]
async fn local_folder_publication_never_clobbers_a_late_destination() {
    let directory = fixture();
    let from = directory.path().join("source");
    let to = directory.path().join("target");
    Endpoint::Local
        .prepare_directory_publish(to.to_str().unwrap())
        .await
        .unwrap();
    assert!(Endpoint::Local
        .publish(from.to_str().unwrap(), to.to_str().unwrap(), false)
        .await
        .is_err());
    assert!(from.join("nested/content.txt").is_file());
    assert_eq!(std::fs::read(to.join("old-only.txt")).unwrap(), b"original");
}

#[cfg(unix)]
#[tokio::test]
async fn folder_links_are_preserved_without_following_external_or_cyclic_targets() {
    let directory = fixture();
    std::os::unix::fs::symlink("..", directory.path().join("source/nested/cycle")).unwrap();
    std::os::unix::fs::symlink("/outside/missing", directory.path().join("source/dangling"))
        .unwrap();
    let receipt = run(
        directory.path(),
        Faults::default(),
        Arc::new(AtomicBool::new(false)),
    )
    .await;
    assert_eq!(receipt.phase, Phase::Completed, "{receipt:?}");
    assert_eq!(
        std::fs::read_link(directory.path().join("target/nested/cycle")).unwrap(),
        Path::new("..")
    );
    assert_eq!(
        std::fs::read_link(directory.path().join("target/dangling")).unwrap(),
        Path::new("/outside/missing")
    );
}
