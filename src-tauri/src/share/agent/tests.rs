use super::*;
use serde_json::{json, Value};
use std::io;
use std::pin::Pin;
use std::task::{Context, Poll};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, DuplexStream, ReadBuf};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::protocol::{frame::coding::CloseCode, CloseFrame, Role};
use tokio_tungstenite::WebSocketStream;

const TEST_TIMEOUT: Duration = Duration::from_secs(5);
type Relay = WebSocketStream<DuplexStream>;

// In-memory relay transport with an independently failing outbound half.
struct AgentTransport {
    inner: DuplexStream,
    fail_writes: Arc<AtomicBool>,
}

impl AsyncRead for AgentTransport {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_read(cx, buf)
    }
}

impl AsyncWrite for AgentTransport {
    fn poll_write(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &[u8],
    ) -> Poll<io::Result<usize>> {
        if self.fail_writes.load(Ordering::Relaxed) {
            return Poll::Ready(Err(io::ErrorKind::BrokenPipe.into()));
        }
        Pin::new(&mut self.inner).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_flush(cx)
    }

    fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.inner).poll_shutdown(cx)
    }
}

#[derive(Clone, Copy, Debug)]
enum Exit {
    Disconnect,
    Cancel,
    ShareStopped,
    AuthFailed,
    WriterFailed,
    Stop,
    DropOwner,
}

struct Session {
    relay: Option<Relay>,
    slot: Option<AgentSlot>,
    outcome: oneshot::Receiver<SessionResult>,
    fail_writes: Arc<AtomicBool>,
}

impl Session {
    async fn start(target: String, version: i32) -> Self {
        Self::with_online(target, version, std::future::ready(())).await
    }

    async fn with_online(
        target: String,
        version: i32,
        on_online: impl Future<Output = ()> + Send + 'static,
    ) -> Self {
        let (client, server) = tokio::io::duplex(65536);
        let fail_writes = Arc::new(AtomicBool::new(false));
        let ws = WebSocketStream::from_raw_socket(
            AgentTransport {
                inner: client,
                fail_writes: fail_writes.clone(),
            },
            Role::Client,
            None,
        )
        .await;
        let mut relay = WebSocketStream::from_raw_socket(server, Role::Server, None).await;
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_task = cancel.clone();
        let (sent, outcome) = oneshot::channel();
        let handle = tokio::spawn(async move {
            let result =
                run_connected_session(ws, None, None, None, &target, cancel_task, on_online).await;
            let _ = sent.send(result);
        });
        // Keep the real owner guard alive during setup, including assertion failures.
        let slot = AgentSlot { cancel, handle };
        let hello = timeout(TEST_TIMEOUT, relay.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(hello.to_text().unwrap()).unwrap()["type"],
            "hello"
        );
        relay
            .send(Message::Text(
                json!({
                    "type": "ok", "slug": "fixture", "session_id": "fixture-session",
                    "resume_token": "fixture-resume", "v": version,
                })
                .to_string()
                .into(),
            ))
            .await
            .unwrap();
        Self {
            relay: Some(relay),
            slot: Some(slot),
            outcome,
            fail_writes,
        }
    }

    async fn send(&mut self, value: Value) {
        self.relay
            .as_mut()
            .unwrap()
            .send(Message::Text(value.to_string().into()))
            .await
            .unwrap();
    }

    async fn open(&mut self, id: i64, mode: &str, method: &str) {
        self.send(json!({ "type": "open", "stream_id": id, "mode": mode,
            "method": method, "path": "/fixture" }))
            .await;
    }

    async fn frame(&mut self, kind: &str) -> Value {
        timeout(TEST_TIMEOUT, async {
            loop {
                let msg = self.relay.as_mut().unwrap().next().await.unwrap().unwrap();
                if let Message::Text(text) = msg {
                    let value: Value = serde_json::from_str(&text).unwrap();
                    if value["type"] == kind {
                        return value;
                    }
                }
            }
        })
        .await
        .expect("expected relay frame")
    }

    async fn finish(mut self, exit: Exit) {
        match exit {
            Exit::Stop => self.slot.take().unwrap().stop().await,
            Exit::DropOwner => drop(self.slot.take()),
            Exit::Disconnect => drop(self.relay.take()),
            Exit::Cancel => self
                .slot
                .as_ref()
                .unwrap()
                .cancel
                .store(true, Ordering::Relaxed),
            Exit::WriterFailed => {
                self.fail_writes.store(true, Ordering::Relaxed);
                self.send(json!({ "type": "ping" })).await;
            }
            Exit::ShareStopped | Exit::AuthFailed => {
                let reason = if matches!(exit, Exit::ShareStopped) {
                    "share_stopped"
                } else {
                    "auth_failed"
                };
                self.relay
                    .as_mut()
                    .unwrap()
                    .close(Some(CloseFrame {
                        code: CloseCode::Policy,
                        reason: reason.into(),
                    }))
                    .await
                    .unwrap();
            }
        }
        let outcome = timeout(TEST_TIMEOUT, &mut self.outcome)
            .await
            .expect("session ended");
        match exit {
            Exit::Stop | Exit::DropOwner => assert!(outcome.is_err()),
            Exit::ShareStopped => assert!(matches!(outcome, Ok(SessionResult::ShareStopped))),
            Exit::AuthFailed => assert!(matches!(outcome, Ok(SessionResult::AuthFailed))),
            Exit::WriterFailed => {
                assert!(matches!(outcome, Ok(SessionResult::Err(msg)) if msg == "writer ended"))
            }
            Exit::Disconnect | Exit::Cancel => {
                assert!(matches!(outcome, Ok(SessionResult::Ok(ok))
                    if ok.session_id.as_deref() == Some("fixture-session")
                    && ok.resume_token.as_deref() == Some("fixture-resume")));
            }
        }
        if let Some(slot) = self.slot.as_mut() {
            let joined = timeout(TEST_TIMEOUT, &mut slot.handle).await.unwrap();
            if !matches!(exit, Exit::DropOwner) {
                joined.unwrap();
            }
        }
    }
}

async fn listener() -> (TcpListener, String) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let target = format!("http://{}", listener.local_addr().unwrap());
    (listener, target)
}

async fn accept_http(listener: &TcpListener) -> (TcpStream, Vec<u8>) {
    timeout(TEST_TIMEOUT, async {
        loop {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            loop {
                let mut buf = [0; 1024];
                let n = socket.read(&mut buf).await.unwrap();
                // HTTP loopback discovery can connect and close before the request.
                if n == 0 {
                    break;
                }
                bytes.extend_from_slice(&buf[..n]);
                if bytes.windows(4).any(|w| w == b"\r\n\r\n") {
                    return (socket, bytes);
                }
            }
        }
    })
    .await
    .expect("local HTTP request")
}

async fn assert_closed(socket: &mut TcpStream) {
    timeout(TEST_TIMEOUT, async {
        let mut buf = [0; 1024];
        loop {
            match socket.read(&mut buf).await {
                Ok(0) => break,
                Ok(_) => continue,
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::ConnectionReset | io::ErrorKind::ConnectionAborted
                    ) =>
                {
                    break
                }
                Err(e) => panic!("unexpected local read error: {e}"),
            }
        }
    })
    .await
    .expect("session shutdown must close the local proxy socket");
}

#[test]
fn accepts_loopback_only() {
    assert!(is_loopback_host("127.0.0.1"));
    assert!(is_loopback_host("localhost"));
    assert!(is_loopback_host("::1"));
    assert!(is_loopback_host("[::1]"));
    assert!(!is_loopback_host("example.com"));
    assert!(!is_loopback_host("8.8.8.8"));
}

#[tokio::test]
async fn idle_tcp_closes_on_every_session_exit() {
    for exit in [
        Exit::Disconnect,
        Exit::Cancel,
        Exit::ShareStopped,
        Exit::AuthFailed,
        Exit::WriterFailed,
        Exit::Stop,
        Exit::DropOwner,
    ] {
        let (listener, target) = listener().await;
        let mut session = Session::start(target, 1).await;
        session.open(1, protocol::MODE_TCP, "").await;
        let (mut socket, _) = timeout(TEST_TIMEOUT, listener.accept())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(session.frame("end").await["status"], 200);
        session.finish(exit).await;
        assert_closed(&mut socket).await;
    }
}

#[tokio::test]
async fn pending_http_headers_close_before_reconnect() {
    let (listener, target) = listener().await;
    // Reuse the target and stream ID across relay sessions; no old request survives.
    for _ in 0..4 {
        let mut session = Session::start(target.clone(), 1).await;
        session.open(1, "", "GET").await;
        let (mut socket, request) = accept_http(&listener).await;
        assert!(request.starts_with(b"GET /fixture HTTP/1.1"));
        session.finish(Exit::Disconnect).await;
        assert_closed(&mut socket).await;
    }
}

#[tokio::test]
async fn pending_http_upload_closes_on_stop() {
    let (listener, target) = listener().await;
    let mut session = Session::start(target, 1).await;
    session.open(1, "", "POST").await;
    session
        .send(json!({ "type": "data", "stream_id": 1, "chunk": "YWJj" }))
        .await;
    let (mut socket, request) = accept_http(&listener).await;
    assert!(request.starts_with(b"POST /fixture HTTP/1.1"));
    // No request-body close and no local response: both directions are pending.
    session.finish(Exit::Stop).await;
    assert_closed(&mut socket).await;
}

#[tokio::test]
async fn idle_http_response_body_closes_on_stop() {
    let (listener, target) = listener().await;
    let mut session = Session::start(target, 1).await;
    session.open(1, "", "GET").await;
    let (mut socket, _) = accept_http(&listener).await;
    socket
        .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n")
        .await
        .unwrap();
    assert_eq!(session.frame("end").await["status"], 200);
    assert_eq!(session.frame("data").await["chunk"], "YWJj");
    session.finish(Exit::Stop).await;
    assert_closed(&mut socket).await;
}

#[tokio::test]
async fn pending_and_upgraded_websockets_close_with_session() {
    for upgraded in [false, true] {
        let (listener, target) = listener().await;
        let mut session = Session::start(target, 1).await;
        session.open(1, protocol::MODE_STREAM, "GET").await;
        let (mut socket, request) = accept_http(&listener).await;
        assert!(String::from_utf8_lossy(&request).contains("Upgrade: websocket"));
        if upgraded {
            socket.write_all(b"HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n").await.unwrap();
            assert_eq!(session.frame("end").await["status"], 101);
        }
        session.finish(Exit::ShareStopped).await;
        assert_closed(&mut socket).await;
    }
}

#[tokio::test]
async fn completed_http_streams_keep_relay_live() {
    let (listener, target) = listener().await;
    let mut session = Session::start(target, 1).await;
    for id in 1..=3 {
        session.open(id, "", "GET").await;
        let (mut socket, _) = accept_http(&listener).await;
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc")
            .await
            .unwrap();
        assert_eq!(session.frame("end").await["stream_id"], id);
        assert_eq!(session.frame("data").await["chunk"], "YWJj");
        assert_eq!(session.frame("close").await["stream_id"], id);
        session.send(json!({ "type": "ping" })).await;
        session.frame("pong").await;
    }
    session.finish(Exit::Stop).await;
}

#[tokio::test]
async fn binary_streams_still_forward_both_directions_and_close() {
    let (listener, target) = listener().await;
    let mut session = Session::start(target, 2).await;
    session.open(1, protocol::MODE_TCP, "").await;
    let (mut socket, _) = timeout(TEST_TIMEOUT, listener.accept())
        .await
        .unwrap()
        .unwrap();
    session.frame("end").await;
    session
        .relay
        .as_mut()
        .unwrap()
        .send(Message::Binary(encode_data_frame(1, b"up").into()))
        .await
        .unwrap();
    let mut uplink = [0; 2];
    timeout(TEST_TIMEOUT, socket.read_exact(&mut uplink))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(&uplink, b"up");
    socket.write_all(b"down").await.unwrap();
    let data = timeout(TEST_TIMEOUT, session.relay.as_mut().unwrap().next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(
        decode_data_frame(&data.into_data()),
        Some((1, &b"down"[..]))
    );
    session.finish(Exit::Cancel).await;
    assert_closed(&mut socket).await;
}

#[tokio::test]
async fn stop_cancels_pending_online_status_in_the_agent_owner() {
    let (started, waiting) = oneshot::channel();
    let (finished, completed) = oneshot::channel::<()>();
    let session = Session::with_online("http://localhost:1".into(), 1, async move {
        let _ = started.send(());
        std::future::pending::<()>().await;
        let _ = finished.send(());
    })
    .await;
    timeout(TEST_TIMEOUT, waiting).await.unwrap().unwrap();
    session.finish(Exit::Stop).await;
    assert!(
        completed.await.is_err(),
        "Online update must not survive Stop"
    );
}

// Keep task destruction pending without timing assumptions, exposing the window
// between aborting the old owner and completing its join.
struct HoldTaskDrop {
    entered: Option<oneshot::Sender<()>>,
    release: std::sync::mpsc::Receiver<()>,
}

impl Drop for HoldTaskDrop {
    fn drop(&mut self) {
        let _ = self.entered.take().unwrap().send(());
        let _ = self.release.recv();
    }
}

fn snapshot(id: &str, slug: &str) -> AgentSnapshot {
    AgentSnapshot {
        share_id: id.into(),
        slug: slug.into(),
        status: AgentConnState::Connecting,
        target_port: 1,
        error: None,
    }
}

async fn assert_start_shutdown_overlap(stop_all: bool, cancel_shutdown: bool, cancel_start: bool) {
    let statuses = Arc::new(Mutex::new(HashMap::new()));
    let lifecycle = Arc::new(Mutex::new(AgentLifecycle {
        statuses: statuses.clone(),
        slots: HashMap::new(),
    }));
    let (entered, dropping) = oneshot::channel();
    let (release, gate) = std::sync::mpsc::channel();
    let hold = HoldTaskDrop {
        entered: Some(entered),
        release: gate,
    };
    let (running, started) = oneshot::channel();
    lifecycle
        .lock()
        .await
        .start(
            snapshot("share", "old"),
            Arc::new(AtomicBool::new(false)),
            async move {
                let _hold = hold;
                let _ = running.send(());
                std::future::pending::<()>().await;
            },
        )
        .await;
    timeout(TEST_TIMEOUT, started).await.unwrap().unwrap();

    let mut shutdown = tokio::spawn({
        let lifecycle = lifecycle.clone();
        async move {
            let mut lifecycle = lifecycle.lock().await;
            if stop_all {
                lifecycle.stop_all().await;
            } else {
                lifecycle.stop("share").await;
            }
        }
    });
    timeout(TEST_TIMEOUT, dropping).await.unwrap().unwrap();
    if cancel_shutdown {
        shutdown.abort();
        assert!(timeout(TEST_TIMEOUT, &mut shutdown)
            .await
            .unwrap()
            .unwrap_err()
            .is_cancelled());
    }

    // Stop All must also preserve a newly started, unrelated share.
    let new_id = if stop_all && !cancel_shutdown {
        "replacement"
    } else {
        "share"
    };
    let (new_running, new_started) = oneshot::channel();
    let (new_finished, new_dropped) = oneshot::channel::<()>();
    let mut start = Box::pin(async {
        lifecycle
            .lock()
            .await
            .start(
                snapshot(new_id, "new"),
                Arc::new(AtomicBool::new(false)),
                async move {
                    let _ = new_running.send(());
                    std::future::pending::<()>().await;
                    let _ = new_finished.send(());
                },
            )
            .await;
    });
    assert!(futures_util::poll!(&mut start).is_pending());
    assert_eq!(statuses.lock().await.get("share").unwrap().slug, "old");

    if cancel_start {
        drop(start);
        assert!(timeout(TEST_TIMEOUT, new_started).await.unwrap().is_err());
        assert!(timeout(TEST_TIMEOUT, new_dropped).await.unwrap().is_err());
        release.send(()).unwrap();
        timeout(TEST_TIMEOUT, shutdown).await.unwrap().unwrap();
        assert!(lifecycle.lock().await.slots.is_empty());
        assert!(statuses.lock().await.is_empty());
    } else {
        release.send(()).unwrap();
        if !cancel_shutdown {
            timeout(TEST_TIMEOUT, shutdown).await.unwrap().unwrap();
        }
        timeout(TEST_TIMEOUT, start).await.unwrap();
        timeout(TEST_TIMEOUT, new_started).await.unwrap().unwrap();
        assert_eq!(statuses.lock().await.len(), 1);
        assert_eq!(statuses.lock().await.get(new_id).unwrap().slug, "new");
        let mut lifecycle = lifecycle.lock().await;
        assert_eq!(lifecycle.slots.len(), 1);
        assert!(!lifecycle.slots.get(new_id).unwrap().handle.is_finished());
        lifecycle.stop_all().await;
        assert!(lifecycle.slots.is_empty());
        assert!(statuses.lock().await.is_empty());
        assert!(timeout(TEST_TIMEOUT, new_dropped).await.unwrap().is_err());
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn replacement_start_waits_for_stop_and_keeps_its_status() {
    assert_start_shutdown_overlap(false, false, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn unrelated_start_waits_for_stop_all_and_keeps_its_status() {
    assert_start_shutdown_overlap(true, false, false).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_shutdown_still_joins_old_owner_before_start() {
    for stop_all in [false, true] {
        assert_start_shutdown_overlap(stop_all, true, false).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn cancelled_start_waiting_for_shutdown_never_spawns_an_agent() {
    for stop_all in [false, true] {
        assert_start_shutdown_overlap(stop_all, false, true).await;
    }
}
