//! Offline SFTP protocol checks: no production accounts, shell or file data reads.
use super::*;
use russh_sftp::{
    client::SftpSession,
    protocol::{Attrs, File, Handle, Name, OpenFlags, Status},
};
use std::sync::{Arc, Mutex};

const PATH: &str = "/parent/ space ';$() 文件 ";

#[test]
fn permission_wire_preserves_native_integer_evidence() {
    let snapshot = Snapshot {
        kind: EntryKind::File,
        size: u64::MAX,
        modified: Some(1_792_291_234_567_890_100),
        mode: None,
    };
    #[derive(Serialize, Deserialize)]
    struct Wire {
        #[serde(with = "PermissionSnapshot")]
        snapshot: Snapshot,
    }
    let wire = serde_json::to_value(Wire {
        snapshot: snapshot.clone(),
    })
    .unwrap();
    assert_eq!(wire["snapshot"]["size"], u64::MAX.to_string());
    assert_eq!(wire["snapshot"]["modified"], "1792291234567890100");
    let restored: Wire = serde_json::from_value(wire).unwrap();
    assert_eq!(restored.snapshot, snapshot);
    let shared = serde_json::to_value(&snapshot).unwrap();
    assert!(
        shared["size"].is_number(),
        "Do not change the transfer journal schema"
    );
}

async fn apply(
    endpoint: &Endpoint,
    binding: Binding,
    expected: &Metadata,
    set: u32,
    clear: u32,
) -> Result<Outcome, String> {
    super::apply(endpoint, binding, expected, set, clear, || async { Ok(()) }).await
}

#[tokio::test]
async fn session_change_during_metadata_preparation_prevents_write() {
    let (endpoint, observed) = fixture().await;
    let expected = inspect(&endpoint, binding(), PATH).await.unwrap();
    let result = super::apply(&endpoint, binding(), &expected, 0o004, 0, || async {
        Err("Connection changed during preparation".into())
    })
    .await;
    assert!(result.unwrap_err().contains("Connection changed"));
    assert!(observed.lock().unwrap().changes.is_empty());
}

struct Observed {
    attrs: FileAttributes,
    changes: Vec<FileAttributes>,
    parent: String,
    reject: Option<StatusCode>,
    adjust: bool,
    fail_readback: bool,
    unknown_write: bool,
    changed_readback: bool,
    reads: usize,
    copy_ops: Vec<&'static str>,
    deny_copy: bool,
    fail_close: bool,
    unexpected: usize,
}

struct Server(Arc<Mutex<Observed>>);
impl russh_sftp::server::Handler for Server {
    type Error = StatusCode;
    fn unimplemented(&self) -> StatusCode {
        self.0.lock().unwrap().unexpected += 1;
        StatusCode::OpUnsupported
    }
    async fn open(
        &mut self,
        id: u32,
        path: String,
        flags: OpenFlags,
        attrs: FileAttributes,
    ) -> Result<Handle, StatusCode> {
        assert_eq!(path, PATH);
        assert_eq!(
            flags.bits(),
            OpenFlags::READ.bits(),
            "Copy preflight must never create/truncate/write"
        );
        assert_eq!(
            serde_json::to_value(attrs).unwrap(),
            serde_json::to_value(FileAttributes::empty()).unwrap()
        );
        let mut state = self.0.lock().unwrap();
        state.copy_ops.push("open");
        if state.deny_copy {
            return Err(StatusCode::PermissionDenied);
        }
        Ok(Handle { id, handle: path })
    }
    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, StatusCode> {
        assert_eq!(path, PATH);
        let mut state = self.0.lock().unwrap();
        state.copy_ops.push("opendir");
        if state.deny_copy {
            return Err(StatusCode::PermissionDenied);
        }
        Ok(Handle { id, handle: path })
    }
    async fn close(&mut self, id: u32, handle: String) -> Result<Status, StatusCode> {
        assert_eq!(handle, PATH);
        let mut state = self.0.lock().unwrap();
        state.copy_ops.push("close");
        if state.fail_close {
            return Err(StatusCode::Failure);
        }
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: String::new(),
        })
    }
    async fn readlink(&mut self, id: u32, path: String) -> Result<Name, StatusCode> {
        assert_eq!(path, PATH);
        self.0.lock().unwrap().copy_ops.push("readlink");
        Ok(Name {
            id,
            files: vec![File::dummy("/unopened-link-target")],
        })
    }
    async fn realpath(&mut self, id: u32, _: String) -> Result<Name, StatusCode> {
        Ok(Name {
            id,
            files: vec![File::dummy(self.0.lock().unwrap().parent.clone())],
        })
    }
    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, StatusCode> {
        assert_eq!(path, PATH, "Literal native path must survive unchanged");
        let mut state = self.0.lock().unwrap();
        state.reads += 1;
        if state.fail_readback && !state.changes.is_empty() {
            return Err(StatusCode::PermissionDenied);
        }
        Ok(Attrs {
            id,
            attrs: state.attrs.clone(),
        })
    }
    async fn setstat(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusCode> {
        assert_eq!(path, PATH);
        let mut state = self.0.lock().unwrap();
        let mode = attrs.permissions.unwrap();
        assert!(
            attrs.size.is_none()
                && attrs.uid.is_none()
                && attrs.gid.is_none()
                && attrs.atime.is_none()
                && attrs.mtime.is_none(),
            "Only permission attributes may be sent"
        );
        assert_eq!(mode & !0o7777, 0, "File type bits must not reach SETSTAT");
        state.changes.push(attrs);
        if let Some(status) = state.reject {
            return Err(status);
        }
        let kind = state.attrs.permissions.unwrap_or(0) & 0o170000;
        state.attrs.permissions = Some(kind | if state.adjust { mode & !0o2000 } else { mode });
        if state.changed_readback {
            state.attrs.uid = Some(999);
            state.attrs.size = Some(99);
            state.attrs.mtime = Some(20);
        }
        if state.unknown_write {
            return Err(StatusCode::Failure);
        }
        Ok(Status {
            id,
            status_code: StatusCode::Ok,
            error_message: String::new(),
            language_tag: String::new(),
        })
    }
}

fn binding() -> Binding {
    Binding {
        identity: "endpoint-and-account".into(),
        session: "channel-one".into(),
        model: Model::Posix,
    }
}

async fn fixture_stream() -> (tokio::io::DuplexStream, Arc<Mutex<Observed>>) {
    let mut attrs = FileAttributes::empty();
    attrs.permissions = Some(0o102640);
    attrs.uid = Some(0);
    attrs.gid = Some(123);
    attrs.size = Some(42);
    attrs.mtime = Some(10);
    let observed = Arc::new(Mutex::new(Observed {
        attrs,
        changes: Vec::new(),
        parent: "/parent".into(),
        reject: None,
        adjust: false,
        fail_readback: false,
        unknown_write: false,
        changed_readback: false,
        reads: 0,
        copy_ops: Vec::new(),
        deny_copy: false,
        fail_close: false,
        unexpected: 0,
    }));
    let (client, server) = tokio::io::duplex(32 * 1024);
    russh_sftp::server::run(server, Server(observed.clone())).await;
    (client, observed)
}

async fn fixture() -> (Endpoint, Arc<Mutex<Observed>>) {
    let (client, observed) = fixture_stream().await;
    (
        Endpoint::Remote(Arc::new(SftpSession::new(client).await.unwrap())),
        observed,
    )
}

#[tokio::test]
async fn copy_preflight_checks_only_selected_sources_without_data_reads_or_directory_scans() {
    for (mode, expected) in [
        (0o100000, vec!["open", "close"]),
        (0o040000, vec!["opendir", "close"]),
        (0o120000, vec!["readlink"]),
        (0o010000, vec![]),
    ] {
        let (client, observed) = fixture_stream().await;
        observed.lock().unwrap().attrs.permissions = Some(mode);
        let session = russh_sftp::client::RawSftpSession::new(client);
        session.init().await.unwrap();
        let result = access::check_remote_copy(&session, PATH).await;
        assert_eq!(result.is_ok(), mode != 0o010000);
        let state = observed.lock().unwrap();
        assert_eq!(state.copy_ops, expected);
        assert_eq!(state.reads, 1);
        assert!(state.changes.is_empty());
        assert_eq!(
            state.unexpected, 0,
            "No READ, READDIR, mutation or other request"
        );
    }
}

#[tokio::test]
async fn copy_preflight_denials_close_failures_and_invalid_paths_never_claim_success() {
    for mode in [0o100644, 0o040755] {
        for (deny, fail_close) in [(true, false), (false, true)] {
            let (client, observed) = fixture_stream().await;
            {
                let mut state = observed.lock().unwrap();
                state.attrs.permissions = Some(mode);
                state.deny_copy = deny;
                state.fail_close = fail_close;
            }
            let session = russh_sftp::client::RawSftpSession::new(client);
            session.init().await.unwrap();
            assert!(access::check_remote_copy(&session, "").await.is_err());
            assert_eq!(
                observed.lock().unwrap().reads,
                0,
                "Invalid paths make no requests"
            );
            let error = access::check_remote_copy(&session, PATH).await.unwrap_err();
            assert_eq!(error.contains("Permission denied"), deny);
            let state = observed.lock().unwrap();
            assert_eq!(state.copy_ops.len(), if deny { 1 } else { 2 });
            assert_eq!(state.unexpected, 0);
            assert!(state.changes.is_empty());
        }
    }
}

#[test]
fn masks_and_model_do_not_guess_authority() {
    assert_eq!(changed_mode(0o102640, 0o004, 0o040).unwrap(), 0o2604);
    assert!(changed_mode(0o644, 0o1000, 0).is_err());
    assert!(changed_mode(0o644, 0o004, 0o004).is_err());
    assert!(changed_mode(0, u32::MAX, 0).is_err());
    assert_eq!(remote_model(None), Model::Unknown);
    assert_eq!(remote_model(Some("windows")), Model::Windows);
    assert_eq!(remote_model(Some("linux")), Model::Posix);
    assert_eq!(remote_model(Some("ubuntu")), Model::Posix);
    assert!(validate_path(" x ").is_ok());
    assert!(validate_path("").is_err());
    assert!(validate_path("a\0b").is_err());
}

#[test]
fn remote_model_accepts_detector_identifiers_without_a_distribution_allowlist() {
    for os in [None, Some(""), Some(" \t\r\n ")] {
        assert_eq!(remote_model(os), Model::Unknown);
    }
    for os in ["windows", " Windows ", "WINDOWS"] {
        assert_eq!(remote_model(Some(os)), Model::Windows);
    }
    for os in [
        "gentoo",
        "void",
        "freebsd",
        "openbsd",
        "sunos",
        "future-distro",
        " linux ",
    ] {
        assert_eq!(remote_model(Some(os)), Model::Posix, "{os}");
    }
}

#[tokio::test]
async fn acknowledged_change_with_new_session_is_not_verified() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let (endpoint, observed) = fixture().await;
    let expected = inspect(&endpoint, binding(), PATH).await.unwrap();
    let checks = AtomicUsize::new(0);
    let outcome = super::apply(&endpoint, binding(), &expected, 0o004, 0, || async {
        if checks.fetch_add(1, Ordering::SeqCst) == 0 {
            Ok(())
        } else {
            Err("Session was replaced after acknowledgement".into())
        }
    })
    .await
    .unwrap();
    assert_eq!(outcome.status, OutcomeStatus::AppliedUnverified);
    assert!(outcome.metadata.is_none());
    assert_eq!(observed.lock().unwrap().changes.len(), 1);
}

#[tokio::test]
async fn changed_readback_evidence_is_not_claimed_verified() {
    let (endpoint, observed) = fixture().await;
    let expected = inspect(&endpoint, binding(), PATH).await.unwrap();
    observed.lock().unwrap().changed_readback = true;
    let outcome = apply(&endpoint, binding(), &expected, 0o004, 0)
        .await
        .unwrap();
    assert_eq!(outcome.status, OutcomeStatus::AppliedUnverified);
    assert!(outcome.metadata.is_none());
    assert_eq!(observed.lock().unwrap().changes.len(), 1);
}

#[tokio::test]
async fn unknown_mode_is_not_zero_and_kind_is_not_assumed_regular() {
    let (endpoint, state) = fixture().await;
    for mode in [
        None,
        Some(0o100000),
        Some(0o120777),
        Some(0o010644),
        Some(0o644),
    ] {
        state.lock().unwrap().attrs.permissions = mode;
        let metadata = inspect(&endpoint, binding(), PATH).await.unwrap();
        assert_eq!(metadata.snapshot.mode, mode);
        assert_eq!(metadata.uid, Some(0));
        assert_eq!(metadata.link_count, None);
        assert_eq!(metadata.edit_unavailable.is_none(), mode == Some(0o100000));
    }
    assert!(state.lock().unwrap().changes.is_empty());
}

#[tokio::test]
async fn chmod_uses_no_content_open_and_preserves_special_bits() {
    let (endpoint, state) = fixture().await;
    state.lock().unwrap().attrs.permissions = Some(0o107000);
    let metadata = inspect(&endpoint, binding(), PATH).await.unwrap();
    let outcome = apply(&endpoint, binding(), &metadata, 0o600, 0)
        .await
        .unwrap();
    assert_eq!(outcome.status, OutcomeStatus::Verified);
    assert_eq!(state.lock().unwrap().changes[0].permissions, Some(0o7600));
    assert_eq!(state.lock().unwrap().changes.len(), 1);
    assert_eq!(outcome.metadata.unwrap().snapshot.mode, Some(0o107600));
}

#[tokio::test]
async fn stale_session_parent_kind_and_mode_never_write() {
    let (endpoint, state) = fixture().await;
    let metadata = inspect(&endpoint, binding(), PATH).await.unwrap();
    let mut reconnected = binding();
    reconnected.session = "channel-two".into();
    assert!(apply(&endpoint, reconnected, &metadata, 0o004, 0)
        .await
        .is_err());
    let mut other_account = binding();
    other_account.identity = "other-user".into();
    assert!(apply(&endpoint, other_account, &metadata, 0o004, 0)
        .await
        .is_err());
    state.lock().unwrap().parent = "/elsewhere".into();
    assert!(apply(&endpoint, binding(), &metadata, 0o004, 0)
        .await
        .is_err());
    state.lock().unwrap().parent = "/parent".into();
    state.lock().unwrap().attrs.permissions = Some(0o102600);
    assert!(apply(&endpoint, binding(), &metadata, 0o004, 0)
        .await
        .is_err());
    state.lock().unwrap().attrs.permissions = Some(0o120777);
    assert!(apply(&endpoint, binding(), &metadata, 0o004, 0)
        .await
        .is_err());
    assert!(state.lock().unwrap().changes.is_empty());
}

#[tokio::test]
async fn no_op_is_read_only_and_invalid_masks_never_reach_server() {
    let (endpoint, state) = fixture().await;
    let metadata = inspect(&endpoint, binding(), PATH).await.unwrap();
    assert_eq!(
        apply(&endpoint, binding(), &metadata, 0, 0)
            .await
            .unwrap()
            .status,
        OutcomeStatus::Verified
    );
    assert!(apply(&endpoint, binding(), &metadata, 0o100000, 0)
        .await
        .is_err());
    assert!(state.lock().unwrap().changes.is_empty());
}

#[tokio::test]
async fn rejection_adjustment_and_unverified_ack_are_distinct() {
    for (reject, adjust, fail_readback, unknown_write, expected) in [
        (
            Some(StatusCode::PermissionDenied),
            false,
            false,
            false,
            OutcomeStatus::Rejected,
        ),
        (
            Some(StatusCode::OpUnsupported),
            false,
            false,
            false,
            OutcomeStatus::Rejected,
        ),
        (None, true, false, false, OutcomeStatus::Adjusted),
        (None, false, true, false, OutcomeStatus::AppliedUnverified),
        (None, false, false, true, OutcomeStatus::Unknown),
    ] {
        let (endpoint, state) = fixture().await;
        let metadata = inspect(&endpoint, binding(), PATH).await.unwrap();
        {
            let mut state = state.lock().unwrap();
            state.reject = reject;
            state.adjust = adjust;
            state.fail_readback = fail_readback;
            state.unknown_write = unknown_write;
        }
        assert_eq!(
            apply(&endpoint, binding(), &metadata, 0o004, 0)
                .await
                .unwrap()
                .status,
            expected
        );
        assert_eq!(
            state.lock().unwrap().changes.len(),
            1,
            "Never replay an uncertain mutation"
        );
    }
}

#[tokio::test]
async fn metadata_mutation_reuses_native_parent_child_admission() {
    let directory = tempfile::tempdir().unwrap();
    let service = crate::file_transfers::Service::new(directory.path().into());
    let root = directory.path().join("folder");
    tokio::fs::create_dir(&root).await.unwrap();
    let root = root.to_str().unwrap();
    let lease = service
        .reserve_metadata_change(&Endpoint::Local, "local", root)
        .await
        .unwrap();
    let child = std::path::Path::new(root).join("child");
    assert!(service
        .reserve_metadata_change(&Endpoint::Local, "local", child.to_str().unwrap())
        .await
        .is_err());
    drop(lease);
    assert!(service
        .reserve_metadata_change(&Endpoint::Local, "local", child.to_str().unwrap())
        .await
        .is_ok());
}

#[cfg(windows)]
#[tokio::test]
async fn windows_metadata_never_exposes_fake_unix_mode_or_successful_chmod() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("entry");
    tokio::fs::write(&path, b"unchanged").await.unwrap();
    let binding = Binding {
        identity: "local".into(),
        session: "local".into(),
        model: Model::Windows,
    };
    let metadata = inspect(&Endpoint::Local, binding.clone(), path.to_str().unwrap())
        .await
        .unwrap();
    assert_eq!(metadata.snapshot.mode, None);
    assert_eq!(metadata.read_only, Some(false));
    if metadata.system_editor {
        assert_eq!(metadata.edit_unavailable, None);
    } else {
        assert!(metadata
            .edit_unavailable
            .as_ref()
            .unwrap()
            .contains("access-control"));
    }
    assert!(apply(&Endpoint::Local, binding, &metadata, 0o777, 0)
        .await
        .is_err());
    assert_eq!(tokio::fs::read(path).await.unwrap(), b"unchanged");
}
