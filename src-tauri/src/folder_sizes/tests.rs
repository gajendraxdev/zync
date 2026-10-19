use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[test]
fn bounded_admission_and_single_claim() {
    let service = Service::default();
    for i in 0..MAX_ADMITTED {
        service.begin(i.to_string(), "local".into()).unwrap();
    }
    assert!(service.begin("overflow".into(), "local".into()).is_err());
    assert!(service.claim("0", "other").is_err());
    let first = service.claim("0", "local").unwrap();
    assert!(service.claim("0", "local").is_err());
    let second = service.claim("1", "local").unwrap();
    assert!(Arc::ptr_eq(&first.gate, &second.gate));
    service.cancel("0");
    assert!(*first.cancel.borrow());
    drop(first);
    service.begin("replacement".into(), "local".into()).unwrap();
    service.cancel("replacement");
    assert!(service.claim("replacement", "local").is_err());
}

#[test]
fn remote_names_never_inherit_windows_leaf_rules() {
    use crate::file_transfers::endpoint::posix_child;
    assert_eq!(
        posix_child("/root", "config:old\\copy ").unwrap(),
        "/root/config:old\\copy "
    );
    for name in ["", ".", "..", "x/y", "x\0y"] {
        assert!(posix_child("/root", name).is_err());
    }
}

#[tokio::test]
async fn local_logical_bytes_and_empty_directories() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("nested")).unwrap();
    std::fs::create_dir(root.path().join("empty")).unwrap();
    std::fs::write(root.path().join("a"), [0; 7]).unwrap();
    std::fs::write(root.path().join("nested/b"), [0; 11]).unwrap();
    let result = calculate(&Endpoint::Local, root.path().to_str().unwrap()).await;
    assert!(result.complete, "{result:?}");
    assert_eq!(result.bytes, "18");
    assert_eq!((result.files, result.folders, result.entries), (2, 2, 4));
}

// This fixture needs arbitrary filename bytes; macOS filesystems can reject invalid UTF-8.
#[cfg(target_os = "linux")]
#[tokio::test]
async fn a_bad_entry_name_does_not_hide_later_files() {
    use std::os::unix::ffi::OsStringExt;

    let root = tempfile::tempdir().unwrap();
    std::fs::write(
        root.path()
            .join(std::ffi::OsString::from_vec(b"invalid-\xff".to_vec())),
        [0; 3],
    )
    .unwrap();
    std::fs::write(root.path().join("valid"), [0; 7]).unwrap();
    let result = calculate(&Endpoint::Local, root.path().to_str().unwrap()).await;
    assert!(!result.complete);
    assert_eq!(result.errors, 1);
    assert_eq!(result.files, 1);
    assert_eq!(result.bytes, "7");
}

#[tokio::test]
async fn cancelled_and_missing_are_not_empty_success() {
    let root = tempfile::tempdir().unwrap();
    let service = Service::default();
    service.begin("cancelled".into(), "local".into()).unwrap();
    let lease = service.claim("cancelled", "local").unwrap();
    service.cancel("cancelled");
    let started = std::cell::Cell::new(false);
    let cancelled = lease
        .run(async {
            started.set(true);
            Ok::<(), String>(())
        })
        .await;
    assert!(
        !started.get(),
        "a retained cancellation must prevent even a ready scan from starting"
    );
    assert_eq!(cancelled.unwrap_err(), "Folder-size scan cancelled");
    let missing = calculate(
        &Endpoint::Local,
        root.path().join("missing").to_str().unwrap(),
    )
    .await;
    assert!(!missing.complete);
    assert!(!missing.reason.is_empty());
}

#[tokio::test]
async fn packet_limit_precedes_decoder_allocation() {
    for length in [0u32, 256 * 1024 + 1, u32::MAX] {
        let (mut writer, reader) = tokio::io::duplex(64);
        writer.write_all(&length.to_be_bytes()).await.unwrap();
        writer.write_all(&[0, 0, 0, 1, 99]).await.unwrap();
        let mut limited = PacketLimited::new(reader);
        let mut header = [0; 4];
        assert_eq!(
            limited.read_exact(&mut header).await.unwrap_err().kind(),
            std::io::ErrorKind::InvalidData
        );
        for _ in 0..3 {
            assert_eq!(
                limited.read(&mut header).await.unwrap(),
                0,
                "retries must never expose the rejected header or later frames"
            );
        }
    }
}

#[tokio::test]
async fn rejected_packet_stops_the_raw_sftp_reader() {
    let (mut peer, stream) = tokio::io::duplex(64);
    // Keep this small enough that a regression cannot allocate gigabytes.
    peer.write_all(&(256 * 1024 + 1u32).to_be_bytes())
        .await
        .unwrap();
    let raw = russh_sftp::client::RawSftpSession::new(PacketLimited::new(stream));
    let mut outgoing = Vec::new();
    tokio::time::timeout(Duration::from_secs(1), peer.read_to_end(&mut outgoing))
        .await
        .expect("the reader must close rather than retry forever")
        .unwrap();
    assert!(raw
        .init()
        .await
        .unwrap_err()
        .to_string()
        .contains("session closed"));
}

#[tokio::test]
async fn packet_wrapper_preserves_fragmented_frames_and_writes() {
    let (mut peer, stream) = tokio::io::duplex(64);
    let mut stream = PacketLimited::new(stream);
    let frames = [0, 0, 0, 2, 11, 12, 0, 0, 0, 1, 99];
    let sender = tokio::spawn(async move {
        for byte in frames {
            peer.write_all(&[byte]).await.unwrap();
            tokio::task::yield_now().await;
        }
        let mut answer = [0; 2];
        peer.read_exact(&mut answer).await.unwrap();
        assert_eq!(answer, [7, 8]);
    });
    let mut received = [0; 11];
    stream.read_exact(&mut received).await.unwrap();
    assert_eq!(received, frames);
    stream.write_all(&[7, 8]).await.unwrap();
    sender.await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn symlinks_are_not_followed() {
    let root = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(root.path(), root.path().join("cycle")).unwrap();
    let result = calculate(&Endpoint::Local, root.path().to_str().unwrap()).await;
    assert!(result.complete);
    assert_eq!(result.skipped, 1);
    assert_eq!(result.bytes, "0");
}

#[tokio::test]
async fn local_depth_budget_is_partial_not_zero_or_complete() {
    let root = tempfile::tempdir().unwrap();
    let mut path = root.path().to_path_buf();
    for _ in 0..66 {
        path.push("d");
        std::fs::create_dir(&path).unwrap();
    }
    let result = calculate(&Endpoint::Local, root.path().to_str().unwrap()).await;
    assert!(!result.complete);
    assert!(result.reason.contains("Depth limit"), "{result:?}");
    assert_eq!(result.folders, 65);
}

#[derive(Default)]
struct Observed {
    pages: u32,
    closes: u32,
    unexpected: u32,
}
struct Server {
    observed: Arc<Mutex<Observed>>,
    folders: bool,
    hang: bool,
    end_after: Option<u32>,
    invalid_entry: bool,
}
impl russh_sftp::server::Handler for Server {
    type Error = russh_sftp::protocol::StatusCode;
    fn unimplemented(&self) -> Self::Error {
        self.observed.lock().unwrap().unexpected += 1;
        Self::Error::OpUnsupported
    }
    async fn lstat(
        &mut self,
        id: u32,
        path: String,
    ) -> Result<russh_sftp::protocol::Attrs, Self::Error> {
        let mut attrs = russh_sftp::protocol::FileAttributes::empty();
        attrs.permissions = Some(if path == "/root" {
            0o040755
        } else {
            assert_eq!(
                path, "/root/name:with\\slash ",
                "remote leaves are never Windows-normalized"
            );
            0o100644
        });
        attrs.size = Some(42);
        attrs.uid = Some(1000);
        attrs.gid = Some(1000);
        attrs.mtime = Some(1_700_000_000);
        Ok(russh_sftp::protocol::Attrs { id, attrs })
    }
    async fn realpath(
        &mut self,
        id: u32,
        path: String,
    ) -> Result<russh_sftp::protocol::Name, Self::Error> {
        assert!(path == "." || path == "/root");
        Ok(russh_sftp::protocol::Name {
            id,
            files: vec![russh_sftp::protocol::File {
                filename: "/root".into(),
                longname: String::new(),
                attrs: russh_sftp::protocol::FileAttributes::empty(),
            }],
        })
    }
    async fn opendir(
        &mut self,
        id: u32,
        path: String,
    ) -> Result<russh_sftp::protocol::Handle, Self::Error> {
        Ok(russh_sftp::protocol::Handle { id, handle: path })
    }
    async fn readdir(
        &mut self,
        id: u32,
        _handle: String,
    ) -> Result<russh_sftp::protocol::Name, Self::Error> {
        if self.hang {
            std::future::pending::<()>().await;
        }
        let mut observed = self.observed.lock().unwrap();
        let page = observed.pages;
        if self.end_after == Some(page) {
            return Err(Self::Error::Eof);
        }
        observed.pages += 1;
        let files = (0..128)
            .map(|i| {
                let mut attrs = russh_sftp::protocol::FileAttributes::empty();
                attrs.permissions = Some(if self.folders { 0o040755 } else { 0o100644 });
                attrs.size = Some(10);
                let filename = if self.invalid_entry && i == 1 {
                    "bad/name".to_owned()
                } else if self.end_after.is_some() && i == 0 {
                    attrs = russh_sftp::protocol::FileAttributes::empty();
                    "name:with\\slash ".to_owned()
                } else {
                    format!(
                        "{page}-{i}{}",
                        if self.folders {
                            "x".repeat(1024)
                        } else {
                            String::new()
                        }
                    )
                };
                russh_sftp::protocol::File {
                    filename,
                    longname: String::new(),
                    attrs,
                }
            })
            .collect();
        Ok(russh_sftp::protocol::Name { id, files })
    }
    async fn close(
        &mut self,
        id: u32,
        _handle: String,
    ) -> Result<russh_sftp::protocol::Status, Self::Error> {
        self.observed.lock().unwrap().closes += 1;
        Ok(russh_sftp::protocol::Status {
            id,
            status_code: Self::Error::Ok,
            error_message: String::new(),
            language_tag: String::new(),
        })
    }
}

async fn remote(folders: bool, hang: bool) -> (Endpoint, Arc<Mutex<Observed>>) {
    remote_with_pages(folders, hang, None).await
}

async fn remote_with_pages(
    folders: bool,
    hang: bool,
    end_after: Option<u32>,
) -> (Endpoint, Arc<Mutex<Observed>>) {
    remote_with_invalid_entry(folders, hang, end_after, false).await
}

async fn remote_with_invalid_entry(
    folders: bool,
    hang: bool,
    end_after: Option<u32>,
    invalid_entry: bool,
) -> (Endpoint, Arc<Mutex<Observed>>) {
    let observed = Arc::new(Mutex::new(Observed::default()));
    let (client, server) = tokio::io::duplex(32 * 1024);
    russh_sftp::server::run(
        server,
        Server {
            observed: observed.clone(),
            folders,
            hang,
            end_after,
            invalid_entry,
        },
    )
    .await;
    let raw = russh_sftp::client::RawSftpSession::new(PacketLimited::new(client));
    raw.init().await.unwrap();
    (Endpoint::Remote(raw), observed)
}

#[tokio::test]
async fn arbitrarily_large_remote_directory_stops_without_full_materialization() {
    let (endpoint, observed) = remote(false, false).await;
    let result = calculate(&endpoint, "/root").await;
    assert!(!result.complete);
    assert_eq!(result.entries, 100_000);
    assert_eq!(result.bytes, "1000000");
    assert!(result.reason.contains("Entry limit"));
    let observed = observed.lock().unwrap();
    assert_eq!(observed.pages, 782);
    assert_eq!(observed.closes, 1);
    assert_eq!(
        observed.unexpected, 0,
        "no file OPEN/READ, shell or mutation"
    );
}

#[tokio::test]
async fn remote_pending_paths_are_memory_budgeted_and_handles_close() {
    let (endpoint, observed) = remote(true, false).await;
    let result = calculate(&endpoint, "/root").await;
    assert!(!result.complete);
    assert!(result.reason.contains("memory limit"), "{result:?}");
    assert!(result.entries < 1100);
    assert_eq!(observed.lock().unwrap().closes, 1);
}

#[tokio::test]
async fn stalled_remote_read_obeys_deadline() {
    let (endpoint, _) = remote(false, true).await;
    let result = scan::calculate_with_time(&endpoint, "/root", Duration::from_millis(20)).await;
    assert!(!result.complete);
    assert!(result.reason.contains("Time limit"));
}

#[tokio::test]
async fn cancellation_wakes_queued_work_without_waiting_for_the_active_scan() {
    let service = Service::default();
    service.begin("active".into(), "local".into()).unwrap();
    service.begin("waiting".into(), "local".into()).unwrap();
    let first = service.claim("active", "local").unwrap();
    let second = service.claim("waiting", "local").unwrap();
    let _held = first.permits().await.unwrap();
    let waiting = second.run(async {
        let _permits = second.permits().await?;
        Ok(())
    });
    let cancel = async {
        tokio::task::yield_now().await;
        service.cancel("waiting");
    };
    let (outcome, ()) = tokio::time::timeout(Duration::from_secs(1), async {
        tokio::join!(waiting, cancel)
    })
    .await
    .unwrap();
    assert_eq!(outcome.unwrap_err(), "Folder-size scan cancelled");
    drop(second);
    assert_eq!(service.jobs.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn cancellation_covers_an_inflight_stalled_scan() {
    let service = Service::default();
    service.begin("stalled".into(), "ssh".into()).unwrap();
    let lease = service.claim("stalled", "ssh").unwrap();
    let (endpoint, _) = remote(false, true).await;
    let scan = lease.run(async move { Ok(calculate(&endpoint, "/root").await) });
    let cancel = async {
        tokio::time::sleep(Duration::from_millis(10)).await;
        service.cancel("stalled");
    };
    let (outcome, ()) =
        tokio::time::timeout(Duration::from_secs(1), async { tokio::join!(scan, cancel) })
            .await
            .unwrap();
    assert_eq!(outcome.unwrap_err(), "Folder-size scan cancelled");
}

#[tokio::test]
async fn remote_complete_uses_readdir_metadata_and_only_lstats_missing_fields() {
    let (endpoint, observed) = remote_with_pages(false, false, Some(1)).await;
    let result = calculate(&endpoint, "/root").await;
    assert!(result.complete, "{result:?}");
    assert_eq!(result.bytes, "1312");
    assert_eq!(result.entries, 128);
    assert_eq!(observed.lock().unwrap().unexpected, 0);
    let (endpoint, _) = remote_with_pages(false, false, Some(0)).await;
    let result = calculate(&endpoint, "/root").await;
    assert!(result.complete);
    assert_eq!(result.bytes, "0");
}

#[tokio::test]
async fn invalid_remote_entry_does_not_hide_later_entries() {
    let (endpoint, observed) = remote_with_invalid_entry(false, false, Some(1), true).await;
    let result = calculate(&endpoint, "/root").await;
    assert!(!result.complete);
    assert_eq!(result.errors, 1);
    assert_eq!(result.entries, 128);
    assert_eq!(result.bytes, "1302");
    assert_eq!(observed.lock().unwrap().closes, 1);
}

#[tokio::test]
async fn skipped_remote_entries_still_consume_the_entry_budget() {
    let (endpoint, observed) = remote_with_invalid_entry(false, false, None, true).await;
    let result = calculate(&endpoint, "/root").await;
    assert_eq!(result.entries, 100_000);
    assert_eq!(result.errors, 782);
    assert!(result.reason.contains("Entry limit"), "{result:?}");
    assert_eq!(observed.lock().unwrap().closes, 1);
}

#[tokio::test]
async fn exec_request_reuses_native_limits_and_requires_sftp_directory_evidence() {
    let (Endpoint::Remote(raw), _) = remote_with_pages(false, false, Some(0)).await else {
        panic!("SFTP fixture")
    };
    let bytes = super::remote::request(&raw, "/root", "nonce")
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["path"], "/root");
    assert_eq!(value["canonical"], "/root");
    assert_eq!(value["home"], "/root");
    assert_eq!(
        value["snapshot"],
        serde_json::json!([0o040755, 42, 1000, 1000, 1_700_000_000])
    );
    assert_eq!(
        value["limits"],
        serde_json::json!({
            "entries": scan::MAX_ENTRIES, "depth": scan::MAX_DEPTH,
            "pendingBytes": scan::MAX_PENDING_BYTES, "pendingFolders": scan::MAX_PENDING_FOLDERS,
            "pathBytes": scan::MAX_PATH_BYTES, "seconds": scan::TIME_LIMIT.as_secs()
        })
    );
    assert!(
        super::remote::request(&raw, "/root/name:with\\slash ", "nonce")
            .await
            .is_none()
    );
}
