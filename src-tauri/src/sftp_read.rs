//! One bounded retry for read-only preparation, never for filesystem mutations.

use std::{future::Future, sync::Arc};

/// Clear only the failed cached instance; a late failure must not evict a replacement.
pub(crate) fn invalidate_if_current<T>(cached: &mut Option<Arc<T>>, failed: &Arc<T>) {
    if is_current_session(cached, failed) {
        *cached = None;
    }
}

/// Runtime identity, not equal contents or a reused connection/generation number.
/// Retaining the expected Arc prevents address reuse while a request is pending.
pub(crate) fn is_current_session<T>(cached: &Option<Arc<T>>, expected: &Arc<T>) -> bool {
    cached
        .as_ref()
        .is_some_and(|current| Arc::ptr_eq(current, expected))
}

pub(crate) fn is_dead_session(err: &anyhow::Error) -> bool {
    let mut current: &dyn std::error::Error = err.as_ref();
    loop {
        if let Some(io_err) = current.downcast_ref::<std::io::Error>() {
            return matches!(
                io_err.kind(),
                std::io::ErrorKind::BrokenPipe
                    | std::io::ErrorKind::ConnectionReset
                    | std::io::ErrorKind::UnexpectedEof
                    | std::io::ErrorKind::NotConnected
            );
        }
        let lower = current.to_string().to_ascii_lowercase();
        if lower.contains("session closed")
            || lower.contains("connection is closed")
            || lower.contains("channel is eof")
        {
            return true;
        }
        current = match current.source() {
            Some(source) => source,
            None => break,
        };
    }
    false
}

/// The caller supplies only a read and identity-checked session recovery. Retry once,
/// before mutation; permission/path errors and a second failure are returned unchanged.
pub(crate) async fn read_with_recovery<S, T, Read, ReadWork, Recover, RecoverWork>(
    session: S,
    read: Read,
    recover: Recover,
) -> Result<(S, T), String>
where
    S: Clone,
    Read: Fn(S) -> ReadWork,
    ReadWork: Future<Output = Result<T, String>>,
    Recover: FnOnce(S) -> RecoverWork,
    RecoverWork: Future<Output = Result<S, String>>,
{
    match read(session.clone()).await {
        Ok(value) => Ok((session, value)),
        Err(error) if is_dead_session(&anyhow::anyhow!(error.clone())) => {
            let fresh = recover(session).await?;
            let value = read(fresh.clone()).await?;
            Ok((fresh, value))
        }
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn reused_connection_generation_cannot_authorize_a_different_transport() {
        let old = Arc::new(0);
        let replacement = Arc::new(0);
        assert!(is_current_session(&Some(old.clone()), &old));
        assert!(!is_current_session(&Some(replacement), &old));
        assert!(!is_current_session(&None, &old));
    }

    #[tokio::test]
    async fn closed_session_is_replaced_once_before_reading_again() {
        let reads = AtomicUsize::new(0);
        let (session, result) = read_with_recovery(
            0,
            |session| {
                reads.fetch_add(1, Ordering::Relaxed);
                async move {
                    if session == 0 {
                        Err("session closed".into())
                    } else {
                        Ok("metadata")
                    }
                }
            },
            |_| async { Ok(1) },
        )
        .await
        .unwrap();
        assert_eq!(
            (session, result, reads.load(Ordering::Relaxed)),
            (1, "metadata", 2)
        );
    }

    #[tokio::test]
    async fn normal_reads_and_path_errors_do_not_reconnect() {
        for outcome in [Ok(Some(3)), Ok(None), Err("Permission denied".to_string())] {
            let expected = outcome.clone();
            let result = read_with_recovery(
                0,
                |_| std::future::ready(outcome.clone()),
                |_| async { panic!("must not reconnect for this read") },
            )
            .await;
            assert_eq!(result.map(|(_, value)| value), expected);
        }
    }

    #[tokio::test]
    async fn recovery_failure_or_second_closed_session_is_not_retried() {
        let reads = AtomicUsize::new(0);
        let result = read_with_recovery(
            0,
            |_| {
                reads.fetch_add(1, Ordering::Relaxed);
                async { Err::<(), _>("session closed".into()) }
            },
            |_| async { Ok(1) },
        )
        .await;
        assert_eq!(result, Err("session closed".into()));
        assert_eq!(reads.load(Ordering::Relaxed), 2);
        let result = read_with_recovery(
            0,
            |_| async { Err::<(), _>("session closed".into()) },
            |_| async { Err("Connection identity changed".into()) },
        )
        .await;
        assert_eq!(result, Err("Connection identity changed".into()));
    }

    #[test]
    fn late_failure_cannot_invalidate_a_new_session() {
        let failed = Arc::new(0);
        let fresh = Arc::new(1);
        let mut cached = Some(fresh.clone());
        invalidate_if_current(&mut cached, &failed);
        assert!(Arc::ptr_eq(cached.as_ref().unwrap(), &fresh));
        cached = Some(failed.clone());
        invalidate_if_current(&mut cached, &failed);
        assert!(cached.is_none());
    }

    #[tokio::test]
    async fn real_sftp_closed_channel_recovers_without_replaying_a_mutation() {
        use russh_sftp::{
            client::SftpSession,
            protocol::{Attrs, FileAttributes, StatusCode},
        };
        struct ReadOnlyServer;
        impl russh_sftp::server::Handler for ReadOnlyServer {
            type Error = StatusCode;
            fn unimplemented(&self) -> StatusCode {
                StatusCode::OpUnsupported
            }
            async fn lstat(&mut self, id: u32, _: String) -> Result<Attrs, StatusCode> {
                let mut attrs = FileAttributes::empty();
                attrs.size = Some(7);
                Ok(Attrs { id, attrs })
            }
        }
        async fn fixture() -> (Arc<SftpSession>, tokio::task::JoinHandle<()>) {
            let (client, server) = tokio::io::duplex(4096);
            let task = tokio::spawn(russh_sftp::server::run(server, ReadOnlyServer));
            (Arc::new(SftpSession::new(client).await.unwrap()), task)
        }
        tokio::time::timeout(std::time::Duration::from_secs(20), async {
            let (closed, server) = fixture().await;
            closed.close().await.unwrap();
            server.await.unwrap();
            // Let the client's stream tasks observe EOF before issuing the next read.
            for _ in 0..10 {
                tokio::task::yield_now().await;
            }
            let (fresh, fresh_server) = fixture().await;
            let expected = fresh.clone();
            let (_, metadata) = read_with_recovery(
                closed,
                |session| async move {
                    session
                        .symlink_metadata("/fixture")
                        .await
                        .map_err(|e| e.to_string())
                },
                |_| async { Ok(fresh.clone()) },
            )
            .await
            .unwrap();
            assert_eq!(metadata.size, Some(7));
            // No mutation handler exists: only the replacement session's LSTAT ran.
            assert_eq!(
                expected.symlink_metadata("/fixture").await.unwrap().size,
                Some(7)
            );
            expected.close().await.unwrap();
            fresh_server.await.unwrap();
        })
        .await
        .expect("closed-session recovery must finish within the fixture deadline");
    }
}
