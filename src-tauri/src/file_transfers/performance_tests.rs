//! Offline packet characterization through the production SFTP adapters. No SSH
//! login or host filesystem is involved; timing is diagnostic, never a CI gate.

use super::{endpoint::Endpoint, *};
use russh_sftp::{
    client::SftpSession,
    protocol::{Data, FileAttributes, Handle, OpenFlags, Status, StatusCode},
};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Observed {
    reads: Vec<usize>,
    writes: Vec<usize>,
    bytes: Vec<u8>,
    closes: usize,
}

fn ok(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: String::new(),
        language_tag: String::new(),
    }
}

#[tokio::test]
async fn remote_adapter_uses_bounded_write_packets_and_acknowledged_close() {
    tokio::time::timeout(Duration::from_secs(20), async {
        let (session, observed, server) = latency_remote(
            Arc::new(Vec::new()),
            Duration::ZERO,
            crate::sftp_read::session_config(),
        )
        .await;
        let mut writer = Endpoint::Remote(session.clone())
            .create_stage("/stage")
            .await
            .unwrap();
        let payload = vec![7; 256 * 1024];
        writer.write(&payload).await.unwrap();
        writer.finish().await.unwrap();
        let observed = observed.lock().unwrap();
        assert!(observed.writes.len() > 1);
        assert!(observed.writes.iter().all(|size| *size <= 32 * 1024));
        assert_eq!(observed.bytes, payload);
        assert_eq!(
            observed.closes, 1,
            "Completion still awaits the explicit file CLOSE"
        );
        drop(observed);
        session.close().await.unwrap();
        server.abort();
        let _ = server.await;
    })
    .await
    .expect("Packet characterization must finish within its fixture deadline");
}

fn receipt(size: usize) -> Receipt {
    Receipt {
        version: 1,
        id: uuid::Uuid::new_v4().to_string(),
        source_connection_id: "source".into(),
        source_path: "/source".into(),
        destination_connection_id: "destination".into(),
        destination_path: "/target".into(),
        destination_identity: "fixture".into(),
        destination_key: "fixture:/target".into(),
        stage_path: "/stage".into(),
        backup_path: "/backup".into(),
        backup_expected: false,
        phase: Phase::Writing,
        created_at: 1,
        transferred: 0,
        total: size as u64,
        error: None,
        warning: None,
        destination_unchanged: true,
        stage_cleaned: false,
        dismissed: false,
        original: None,
        staged: None,
        original_tree: None,
        staged_tree: None,
        combine: None,
    }
}

/// A gated wire peer uses the published codec but lets tests reorder/withhold
/// replies. Both halves are owned by one abort-on-drop task; no real host is used.
struct Peer {
    session: Arc<SftpSession>,
    requests: tokio::sync::mpsc::Receiver<russh_sftp::protocol::Packet>,
    replies: tokio::sync::mpsc::Sender<russh_sftp::protocol::Packet>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Peer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Peer {
    async fn new(limits: Option<(u64, u64)>) -> Self {
        Self::with_config(limits, crate::sftp_read::session_config()).await
    }

    async fn with_config(limits: Option<(u64, u64)>, config: russh_sftp::client::Config) -> Self {
        use russh_sftp::protocol::{ExtendedReply, Packet, Version};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (client, server) = tokio::io::duplex(512 * 1024);
        let (mut read, mut write) = tokio::io::split(server);
        let (requests_tx, requests) = tokio::sync::mpsc::channel(64);
        let (replies, mut replies_rx) = tokio::sync::mpsc::channel::<Packet>(64);
        let automatic = replies.clone();
        let task = tokio::spawn(async move {
            let receiving = async move {
                loop {
                    let Ok(size) = read.read_u32().await else {
                        return;
                    };
                    let size = size as usize;
                    assert!(size <= 256 * 1024);
                    let mut body = vec![0; size];
                    if read.read_exact(&mut body).await.is_err() {
                        return;
                    }
                    let packet = Packet::try_from(&mut bytes::Bytes::from(body)).unwrap();
                    let response = match packet {
                        Packet::Init(_) => {
                            let mut version = Version::new();
                            if limits.is_some() {
                                version
                                    .extensions
                                    .insert("limits@openssh.com".into(), "1".into());
                            }
                            Packet::Version(version)
                        }
                        Packet::Extended(request) => {
                            assert_eq!(request.request, "limits@openssh.com");
                            let (read, write) = limits.unwrap();
                            let data = [256 * 1024u64, read, write, 16]
                                .into_iter()
                                .flat_map(u64::to_be_bytes)
                                .collect();
                            Packet::ExtendedReply(ExtendedReply {
                                id: request.id,
                                data,
                            })
                        }
                        Packet::Open(open) => {
                            assert!(
                                open.pflags.bits() == OpenFlags::READ.bits()
                                    || open.pflags.bits()
                                        == (OpenFlags::WRITE
                                            | OpenFlags::CREATE
                                            | OpenFlags::EXCLUDE)
                                            .bits()
                            );
                            if open.pflags.contains(OpenFlags::WRITE) {
                                assert_eq!(open.attrs.permissions, Some(0o600));
                            }
                            Packet::Handle(Handle {
                                id: open.id,
                                handle: open.filename,
                            })
                        }
                        other => {
                            if requests_tx.send(other).await.is_err() {
                                return;
                            }
                            continue;
                        }
                    };
                    if automatic.send(response).await.is_err() {
                        return;
                    }
                }
            };
            let sending = async move {
                while let Some(packet) = replies_rx.recv().await {
                    let encoded = bytes::Bytes::try_from(packet).unwrap();
                    if write.write_all(&encoded).await.is_err() {
                        return;
                    }
                }
            };
            tokio::select! { _ = receiving => {}, _ = sending => {} }
        });
        let session = Arc::new(SftpSession::new_with_config(client, config).await.unwrap());
        Self {
            session,
            requests,
            replies,
            task,
        }
    }

    async fn next(&mut self) -> russh_sftp::protocol::Packet {
        tokio::time::timeout(Duration::from_secs(5), self.requests.recv())
            .await
            .expect("fixture request timed out")
            .expect("fixture closed")
    }

    async fn reply(&self, packet: impl Into<russh_sftp::protocol::Packet>) {
        self.replies.send(packet.into()).await.unwrap();
    }
}

/// Unlike the old sequential server-handler probe, delay replies concurrently.
/// This models request latency without imposing an artificial server-side lock.
async fn latency_remote(
    source: Arc<Vec<u8>>,
    delay: Duration,
    config: russh_sftp::client::Config,
) -> (
    Arc<SftpSession>,
    Arc<Mutex<Observed>>,
    tokio::task::JoinHandle<()>,
) {
    use russh_sftp::protocol::Packet;
    let mut peer = Peer::with_config(None, config).await;
    let session = peer.session.clone();
    let observed = Arc::new(Mutex::new(Observed::default()));
    let record = observed.clone();
    let task = tokio::spawn(async move {
        let mut responses = tokio::task::JoinSet::new();
        loop {
            tokio::select! {
                request = peer.requests.recv(), if responses.len() < 32 => {
                    let Some(request) = request else { return; };
                    let response = match request {
                        Packet::Read(read) => {
                            record.lock().unwrap().reads.push(read.len as usize);
                            let start = read.offset as usize;
                            if start >= source.len() {
                                let mut status = ok(read.id); status.status_code = StatusCode::Eof;
                                Packet::Status(status)
                            } else {
                                let end = (start + read.len as usize).min(source.len());
                                Packet::Data(Data { id: read.id, data: source[start..end].to_vec() })
                            }
                        }
                        Packet::Write(write) => {
                            let mut record = record.lock().unwrap();
                            assert_eq!(write.offset as usize, record.bytes.len());
                            record.writes.push(write.data.len());
                            record.bytes.extend(write.data);
                            Packet::Status(ok(write.id))
                        }
                        Packet::Close(close) => {
                            record.lock().unwrap().closes += 1;
                            Packet::Status(ok(close.id))
                        }
                        other => panic!("unexpected benchmark packet: {other:?}"),
                    };
                    let replies = peer.replies.clone();
                    responses.spawn(async move {
                        if !delay.is_zero() {
                            tokio::time::sleep(delay).await;
                        }
                        let _ = replies.send(response).await;
                    });
                }
                Some(result) = responses.join_next(), if !responses.is_empty() => { result.unwrap(); }
            }
        }
    });
    (session, observed, task)
}

#[tokio::test]
async fn pipelined_writes_bound_inflight_and_wait_for_all_statuses_before_close() {
    use russh_sftp::protocol::Packet;
    let mut peer = Peer::new(Some((8192, 8192))).await;
    let endpoint = Endpoint::Remote(peer.session.clone());
    let mut writer = endpoint.create_stage("/stage").await.unwrap();
    let payload = vec![17; 256 * 1024];
    let expected = payload.clone();
    let mut task = tokio::spawn(async move {
        writer.write(&payload).await.unwrap();
        writer.finish().await.unwrap();
    });
    let mut held = Vec::new();
    for index in 0..16 {
        let Packet::Write(write) = peer.next().await else {
            panic!("expected WRITE")
        };
        assert_eq!(write.offset, index * 8192);
        assert_eq!(write.data.len(), 8192, "respect negotiated small limits");
        held.push(write);
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(30), peer.requests.recv())
            .await
            .is_err(),
        "a full request window must backpressure rather than grow"
    );
    let mut actual = Vec::new();
    // Reversed responses must not turn queue acceptance into transfer completion.
    for write in held.iter().rev() {
        peer.reply(ok(write.id)).await;
    }
    for write in held {
        actual.extend(write.data);
    }
    loop {
        match peer.next().await {
            Packet::Write(write) => {
                assert_eq!(write.offset as usize, actual.len());
                actual.extend(write.data);
                peer.reply(ok(write.id)).await;
            }
            Packet::Close(close) => {
                assert_eq!(actual, expected);
                assert!(
                    tokio::time::timeout(Duration::from_millis(30), &mut task)
                        .await
                        .is_err(),
                    "CLOSE itself must be acknowledged"
                );
                peer.reply(ok(close.id)).await;
                break;
            }
            other => panic!("unexpected packet: {other:?}"),
        }
    }
    task.await.unwrap();
}

#[tokio::test]
async fn pipelined_reads_preserve_offsets_short_reads_and_reordered_responses() {
    use russh_sftp::protocol::Packet;
    let mut peer = Peer::new(Some((8192, 8192))).await;
    let source: Arc<Vec<u8>> = Arc::new((0..100_123).map(|i| (i % 251) as u8).collect());
    let expected = source.clone();
    let session = peer.session.clone();
    let task = tokio::spawn(async move {
        let mut reader = Endpoint::Remote(session).reader("/source").await.unwrap();
        let mut data = Vec::new();
        reader.read_to_end(&mut data).await.unwrap();
        assert_eq!(data, *expected);
    });
    let Packet::Read(probe) = peer.next().await else {
        panic!("expected initial probe")
    };
    assert_eq!(probe.len, 8192);
    // First short reply teaches the client's actual chunk size.
    peer.reply(Data {
        id: probe.id,
        data: source[..4096].to_vec(),
    })
    .await;
    let mut reads = Vec::new();
    for index in 0..8 {
        let Packet::Read(read) = peer.next().await else {
            panic!("expected READ")
        };
        assert_eq!((read.offset, read.len), (4096 + index * 4096, 4096));
        reads.push(read);
    }
    assert!(
        tokio::time::timeout(Duration::from_millis(30), peer.requests.recv())
            .await
            .is_err()
    );
    // Reverse the whole read window; introduce a later short read too.
    for read in reads.into_iter().rev() {
        let start = read.offset as usize;
        let size = if start == 4096 {
            2000
        } else {
            read.len as usize
        };
        peer.reply(Data {
            id: read.id,
            data: source[start..start + size].to_vec(),
        })
        .await;
    }
    loop {
        match peer.next().await {
            Packet::Read(read) => {
                let start = read.offset as usize;
                if start >= source.len() {
                    let mut status = ok(read.id);
                    status.status_code = StatusCode::Eof;
                    peer.reply(status).await;
                } else {
                    let end = (start + read.len as usize).min(source.len());
                    peer.reply(Data {
                        id: read.id,
                        data: source[start..end].to_vec(),
                    })
                    .await;
                }
            }
            Packet::Close(close) => {
                peer.reply(ok(close.id)).await;
                break;
            }
            other => panic!("unexpected packet: {other:?}"),
        }
    }
    task.await.unwrap();
    // Ignored speculative responses must not poison the shared SFTP session.
    let session = peer.session.clone();
    let check = tokio::spawn(async move { session.symlink_metadata("/source").await.unwrap() });
    let Packet::Lstat(request) = peer.next().await else {
        panic!("expected metadata request")
    };
    peer.reply(russh_sftp::protocol::Attrs {
        id: request.id,
        attrs: FileAttributes::empty(),
    })
    .await;
    check.await.unwrap();
}

#[tokio::test]
async fn late_write_and_close_failures_never_confirm_safe_completion() {
    use russh_sftp::protocol::Packet;
    for fail_write in [true, false] {
        let mut peer = Peer::new(None).await;
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("source");
        tokio::fs::write(&source_path, b"late failure")
            .await
            .unwrap();
        let endpoint = Endpoint::Remote(peer.session.clone());
        let task = tokio::spawn(async move {
            Service::new(dir.path().into())
                .copy_file_data(
                    &mut receipt(12),
                    source_path.to_str().unwrap(),
                    "/stage",
                    12,
                    &Endpoint::Local,
                    &endpoint,
                    None,
                    &Arc::new(AtomicBool::new(false)),
                    &|_, _| {},
                )
                .await
        });
        let Packet::Write(write) = peer.next().await else {
            panic!("expected WRITE")
        };
        let mut status = ok(write.id);
        if fail_write {
            status.status_code = StatusCode::Failure;
            status.error_message = "disk full".into();
        }
        peer.reply(status).await;
        if !fail_write {
            let Packet::Close(close) = peer.next().await else {
                panic!("expected CLOSE")
            };
            let mut status = ok(close.id);
            status.status_code = StatusCode::Failure;
            peer.reply(status).await;
        }
        let (result, confirmed) = task.await.unwrap();
        assert!(result.is_err());
        assert!(
            !confirmed,
            "late failure must retain uncertain staging, not authorize cleanup"
        );
    }
}

#[tokio::test]
async fn cancellation_drains_queued_writes_before_confirming_close() {
    use russh_sftp::protocol::Packet;
    for fail_close in [false, true] {
        let mut peer = Peer::new(Some((8192, 8192))).await;
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("source");
        tokio::fs::write(&source_path, vec![29; 4 * 1024 * 1024])
            .await
            .unwrap();
        let endpoint = Endpoint::Remote(peer.session.clone());
        let token = Arc::new(AtomicBool::new(false));
        let cancel = token.clone();
        let task = tokio::spawn(async move {
            Service::new(dir.path().into())
                .copy_file_data(
                    &mut receipt(4 * 1024 * 1024),
                    source_path.to_str().unwrap(),
                    "/stage",
                    4 * 1024 * 1024,
                    &Endpoint::Local,
                    &endpoint,
                    None,
                    &token,
                    &|_, _| {},
                )
                .await
        });
        let mut held = Vec::new();
        for _ in 0..16 {
            let Packet::Write(write) = peer.next().await else {
                panic!("expected WRITE")
            };
            held.push(write);
        }
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(
            !task.is_finished(),
            "cancellation is not proof of stopped remote writes"
        );
        for write in held {
            peer.reply(ok(write.id)).await;
        }
        let mut end = 0;
        loop {
            match peer.next().await {
                Packet::Write(write) => {
                    end = write.offset + write.data.len() as u64;
                    assert!(
                        end <= BUFFER_SIZE as u64,
                        "only the already-started app chunk may drain"
                    );
                    peer.reply(ok(write.id)).await;
                }
                Packet::Close(close) => {
                    let mut status = ok(close.id);
                    if fail_close {
                        status.status_code = StatusCode::Failure;
                    }
                    peer.reply(status).await;
                    break;
                }
                other => panic!("unexpected packet: {other:?}"),
            }
        }
        let (result, confirmed) = task.await.unwrap();
        if fail_close {
            assert!(
                !confirmed,
                "cancel with an unconfirmed CLOSE must not authorize cleanup"
            );
            assert!(result
                .unwrap_err()
                .contains("Destination close was not confirmed"));
        } else {
            assert_eq!(result, Err("Cancelled".into()));
            assert!(confirmed);
        }
        assert_eq!(end, BUFFER_SIZE as u64);
    }
}

#[tokio::test]
async fn transport_loss_wakes_pending_requests_and_keeps_read_recovery_compatible() {
    use russh_sftp::protocol::Packet;
    let mut peer = Peer::new(None).await;
    let session = peer.session.clone();
    let task = tokio::spawn(async move { session.symlink_metadata("/source").await });
    assert!(matches!(peer.next().await, Packet::Lstat(_)));
    peer.task.abort();
    let _ = (&mut peer.task).await;
    let error = tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err();
    assert!(crate::sftp_read::is_dead_session(&anyhow::anyhow!(
        error.clone()
    )));
    assert!(crate::sftp_read::is_dead_session(&anyhow::anyhow!(
        format!("Could not inspect /source: {error}")
    )));
    assert!(!crate::sftp_read::is_dead_session(&anyhow::anyhow!(
        "Permission denied"
    )));
    assert!(!crate::sftp_read::is_dead_session(&anyhow::anyhow!(
        "Timeout"
    )));
}

#[tokio::test]
async fn large_advertised_limits_cannot_expand_the_read_packet_budget() {
    use russh_sftp::protocol::Packet;
    let mut peer = Peer::new(Some((64 * 1024 * 1024, 64 * 1024 * 1024))).await;
    let session = peer.session.clone();
    let task = tokio::spawn(async move {
        let mut reader = Endpoint::Remote(session).reader("/source").await.unwrap();
        let mut byte = [0];
        reader.read(&mut byte).await
    });
    let Packet::Read(read) = peer.next().await else {
        panic!("expected READ")
    };
    assert!(read.len < crate::sftp_read::session_config().max_packet_len);
    // An oversized response must close the decoder before allocating its body.
    peer.reply(Data {
        id: read.id,
        data: vec![0; 256 * 1024 + 1],
    })
    .await;
    assert!(tokio::time::timeout(Duration::from_secs(2), task)
        .await
        .unwrap()
        .unwrap()
        .is_err());
}

/// Opt-in measurement of the existing stream, not a network/SSH throughput claim.
/// Run with `cargo test --lib offline_transfer_latency_probe -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "manual latency characterization; never assert timing on CI"]
async fn offline_transfer_latency_probe() {
    tokio::time::timeout(Duration::from_secs(90), async {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("source");
        let data = Arc::new(
            (0..4 * 1024 * 1024)
                .map(|i| (i % 251) as u8)
                .collect::<Vec<_>>(),
        );
        tokio::fs::write(&source_path, data.as_slice())
            .await
            .unwrap();
        let service = Service::new(directory.path().into());
        println!("direction,window,reply_delay_ms,run,bytes,elapsed_ms,MiB_per_s,reads,writes,tiny_writes");
        // Same published package and packet sizes: isolate pipelining from codec changes.
        for (window, delay_ms) in [(1, 0), (1, 20), (8, 0), (8, 20)] {
            for direction in ["download", "upload", "cross-endpoint"] {
                for run in 1..=3 {
                    let delay = Duration::from_millis(delay_ms);
                    let mut config = crate::sftp_read::session_config();
                    config.max_concurrent_reads = window;
                    if window == 1 {
                        config.max_concurrent_writes = 1;
                    }
                    let (source_session, reads, reader) =
                        latency_remote(data.clone(), delay, config.clone()).await;
                    let (target_session, writes, writer) =
                        latency_remote(Arc::new(Vec::new()), delay, config).await;
                    let source = if direction == "upload" {
                        Endpoint::Local
                    } else {
                        Endpoint::Remote(source_session.clone())
                    };
                    let target = if direction == "download" {
                        Endpoint::Local
                    } else {
                        Endpoint::Remote(target_session.clone())
                    };
                    let source_path = if direction == "upload" {
                        source_path.to_str().unwrap()
                    } else {
                        "/source"
                    };
                    let local_stage = directory
                        .path()
                        .join(format!("stage-{window}-{delay_ms}-{direction}-{run}"));
                    let stage_path = if direction == "download" {
                        local_stage.to_str().unwrap()
                    } else {
                        "/stage"
                    };
                    let mut receipt = receipt(data.len());
                    let token = Arc::new(AtomicBool::new(false));
                    let started = Instant::now();
                    let (result, closed) = service
                        .copy_file_data(
                            &mut receipt,
                            source_path,
                            stage_path,
                            data.len() as u64,
                            &source,
                            &target,
                            None,
                            &token,
                            &|_, _| {},
                        )
                        .await;
                    result.unwrap();
                    assert!(closed);
                    let elapsed = started.elapsed();
                    assert_eq!(receipt.transferred, data.len() as u64);
                    if direction == "download" {
                        assert_eq!(tokio::fs::read(&local_stage).await.unwrap(), *data);
                    } else {
                        assert_eq!(writes.lock().unwrap().bytes, *data);
                        assert_eq!(writes.lock().unwrap().closes, 1);
                    }
                    let read_count = reads.lock().unwrap().reads.len();
                    let observed = writes.lock().unwrap();
                    println!(
                        "{direction},{window},{delay_ms},{run},{},{:.1},{:.2},{read_count},{},{}",
                        data.len(),
                        elapsed.as_secs_f64() * 1000.0,
                        (data.len() as f64 / (1024.0 * 1024.0)) / elapsed.as_secs_f64(),
                        observed.writes.len(),
                        observed.writes.iter().filter(|size| **size < 4096).count()
                    );
                    drop(observed);
                    source_session.close().await.unwrap();
                    target_session.close().await.unwrap();
                    reader.abort();
                    writer.abort();
                    let _ = reader.await;
                    let _ = writer.await;
                }
            }
        }
    })
    .await
    .expect("Offline measurements must finish within the fixture deadline");
}
