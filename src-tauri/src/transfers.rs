//! Small lifecycle helpers for the existing background transfer commands.

use std::collections::HashMap;
use std::future::Future;
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::FutureExt;
use futures_util::{Stream, StreamExt};
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio::sync::Mutex;

pub type TransferRegistry = Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>;

/// Requests cancellation of a registered operation; this does not confirm it stopped.
pub async fn request_cancel(registry: &TransferRegistry, id: &str) -> Result<(), String> {
    let transfers = registry.lock().await;
    let token = transfers
        .get(id)
        .ok_or_else(|| "Transfer is no longer active".to_string())?;
    token.store(true, Ordering::Relaxed);
    Ok(())
}

pub fn check_cancelled(token: &AtomicBool) -> Result<(), String> {
    if token.load(Ordering::Relaxed) {
        Err("Cancelled".to_string())
    } else {
        Ok(())
    }
}

/// Waits for buffered local writes or the remote CLOSE acknowledgement before success.
/// This is not a promise of power-loss durability or remote fsync support.
pub async fn finish_writer<W: AsyncWrite + Unpin>(writer: &mut W) -> Result<(), String> {
    writer
        .shutdown()
        .await
        .map_err(|error| format!("Failed to finish destination file: {error}"))
}

/// Preserves the work error while distinguishing an uncertain destination close.
pub async fn finish_destination<W: AsyncWrite + Unpin>(
    writer: &mut W,
    result: Result<(), String>,
) -> Result<(), String> {
    match (result, finish_writer(writer).await) {
        (Err(error), Err(close_error)) => Err(format!("{error}; {close_error}")),
        (Err(error), Ok(())) => Err(error),
        (Ok(()), close_result) => close_result,
    }
}

/// Stops/joins the owned source reader and closes the destination on every outcome.
/// Only the reader is aborted after failure; destination writes have already returned.
pub async fn finish_pipeline<W: AsyncWrite + Unpin>(
    writer: &mut W,
    reader: tokio::task::JoinHandle<()>,
    copy_result: Result<(), String>,
) -> Result<(), String> {
    if copy_result.is_err() {
        reader.abort();
    }
    let reader_result = reader
        .await
        .map_err(|_| "Source reader task failed unexpectedly".to_string());
    let result = copy_result.and(reader_result);
    finish_destination(writer, result).await
}

/// A failed mkdir is acceptable only when a no-follow probe confirms a directory.
/// Keep the creation error when probing fails or finds another entry type.
pub async fn ensure_directory<Make, Probe>(create: Make, probe: Probe) -> Result<(), String>
where
    Make: Future<Output = Result<(), String>>,
    Probe: Future<Output = Result<bool, String>>,
{
    match create.await {
        Ok(()) => Ok(()),
        Err(error) => match probe.await {
            Ok(true) => Ok(()),
            _ => Err(error),
        },
    }
}

/// A fast filesystem mutation returns false only when execution definitely did not start.
/// Never replay a possibly partial mutation after failure or an unknown outcome.
pub async fn mutation_with_safe_fallback<Attempt, Fallback>(
    attempt: Attempt,
    fallback: Fallback,
) -> Result<(), String>
where
    Attempt: Future<Output = Result<bool, String>>,
    Fallback: Future<Output = Result<(), String>>,
{
    if attempt.await? {
        Ok(())
    } else {
        fallback.await
    }
}

/// Bound SSH request acceptance, not the runtime of an accepted filesystem command.
/// Only explicit rejection before any execution evidence permits streamed fallback.
pub async fn remote_mutation_outcome(
    messages: impl Stream<Item = russh::ChannelMsg>,
    acceptance_deadline: tokio::time::Instant,
    label: &str,
) -> Result<bool, String> {
    futures_util::pin_mut!(messages);
    let mut accepted = false;
    loop {
        let message = if accepted {
            messages.next().await
        } else {
            tokio::time::timeout_at(acceptance_deadline, messages.next()).await.map_err(|_| {
                format!("{label} acceptance was not confirmed; it may still be running. Check destination before retrying")
            })?
        };
        match message {
            Some(russh::ChannelMsg::Failure) if !accepted => return Ok(false),
            Some(russh::ChannelMsg::Failure) => return Err(format!("{label} outcome is unconfirmed after SSH request failure; check destination before retrying")),
            Some(russh::ChannelMsg::Success | russh::ChannelMsg::Data { .. }
                | russh::ChannelMsg::ExtendedData { .. } | russh::ChannelMsg::Eof) => accepted = true,
            Some(russh::ChannelMsg::ExitStatus { exit_status: 0 }) => return Ok(true),
            Some(russh::ChannelMsg::ExitStatus { exit_status }) => return Err(format!("{label} failed (exit {exit_status}); destination may be partial. Check it before retrying")),
            Some(russh::ChannelMsg::ExitSignal { .. }) => return Err(format!("{label} terminated by a signal; destination may be partial. Check it before retrying")),
            None => return Err(format!("{label} channel closed without a confirmed outcome; check destination before retrying")),
            _ => {}
        }
    }
}

/// Registers before acknowledgement and leaves the owned task running if its IPC waiter
/// disappears. Legacy calls return after acceptance; opt-in callers receive its outcome.
pub async fn start_transfer<Operation, Work, Notify>(
    registry: TransferRegistry,
    id: String,
    wait_for_completion: bool,
    operation: Operation,
    notify: Notify,
) -> Result<(), String>
where
    Operation: FnOnce(Arc<AtomicBool>) -> Work + Send + 'static,
    Work: Future<Output = Result<(), String>> + Send + 'static,
    Notify: FnOnce(&Result<(), String>) + Send + 'static,
{
    let task = spawn_owned_transfer(registry, id, operation, notify).await?;
    if wait_for_completion {
        task.await
            .map_err(|error| format!("Transfer task could not finish: {error}"))?
    } else {
        Ok(())
    }
}

/// Single registration/panic/finalization path for legacy and receipt-bearing jobs.
async fn spawn_owned_transfer<T, Operation, Work, Notify>(
    registry: TransferRegistry,
    id: String,
    operation: Operation,
    notify: Notify,
) -> Result<tokio::task::JoinHandle<Result<T, String>>, String>
where
    T: Send + 'static,
    Operation: FnOnce(Arc<AtomicBool>) -> Work + Send + 'static,
    Work: Future<Output = Result<T, String>> + Send + 'static,
    Notify: FnOnce(&Result<T, String>) + Send + 'static,
{
    let token = Arc::new(AtomicBool::new(false));
    {
        let mut transfers = registry.lock().await;
        if id.is_empty() {
            return Err("Transfer ID is required".to_string());
        }
        if transfers.contains_key(&id) {
            return Err("Transfer ID is already active".to_string());
        }
        transfers.insert(id.clone(), token.clone());
    }

    Ok(tokio::spawn(async move {
        let operation_token = token.clone();
        let result = AssertUnwindSafe(async move { operation(operation_token).await })
            .catch_unwind()
            .await
            .unwrap_or_else(|_| Err("Transfer task failed unexpectedly".to_string()));

        {
            let mut transfers = registry.lock().await;
            if transfers
                .get(&id)
                .is_some_and(|registered| Arc::ptr_eq(registered, &token))
            {
                transfers.remove(&id);
            }
        }
        notify(&result);
        result
    }))
}

/// Runs a receipt-bearing job independently of its IPC waiter. The registry is
/// shared with legacy transfers so cancellation and duplicate IDs have one owner.
pub async fn run_owned_transfer<T, Operation, Work>(
    registry: TransferRegistry,
    id: String,
    operation: Operation,
) -> Result<T, String>
where
    T: Send + 'static,
    Operation: FnOnce(Arc<AtomicBool>) -> Work + Send + 'static,
    Work: Future<Output = Result<T, String>> + Send + 'static,
{
    spawn_owned_transfer(registry, id, operation, |_| {})
        .await?
        .await
        .map_err(|error| format!("Transfer task could not finish: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    use std::pin::Pin;
    use std::task::{Context, Poll};
    use tokio::sync::oneshot;

    fn registry() -> TransferRegistry {
        Arc::new(Mutex::new(HashMap::new()))
    }

    #[tokio::test]
    async fn accepted_remote_mutations_can_outlive_the_acceptance_deadline() {
        use russh::{ChannelMsg, CryptoVec};
        for accepted in [
            ChannelMsg::Success,
            ChannelMsg::Eof,
            ChannelMsg::Data {
                data: CryptoVec::new(),
            },
            ChannelMsg::ExtendedData {
                data: CryptoVec::new(),
                ext: 1,
            },
        ] {
            let messages =
                futures_util::stream::iter([accepted]).chain(futures_util::stream::once(async {
                    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
                    ChannelMsg::ExitStatus { exit_status: 0 }
                }));
            assert_eq!(
                remote_mutation_outcome(
                    messages,
                    tokio::time::Instant::now() + std::time::Duration::from_millis(5),
                    "Copy"
                )
                .await,
                Ok(true)
            );
        }
    }

    #[tokio::test]
    async fn uncertain_remote_mutations_never_allow_replay_or_claim_disconnect() {
        use russh::ChannelMsg;
        let deadline = || tokio::time::Instant::now() + std::time::Duration::from_millis(5);
        assert_eq!(
            remote_mutation_outcome(
                futures_util::stream::iter([ChannelMsg::Failure]),
                deadline(),
                "Copy"
            )
            .await,
            Ok(false)
        );
        for messages in [
            vec![ChannelMsg::Success, ChannelMsg::Failure],
            vec![ChannelMsg::Success],
            vec![ChannelMsg::ExitStatus { exit_status: 1 }],
            vec![],
        ] {
            let error =
                remote_mutation_outcome(futures_util::stream::iter(messages), deadline(), "Copy")
                    .await
                    .unwrap_err();
            assert!(!error.starts_with("DISCONNECTED:"));
        }
        let error = remote_mutation_outcome(futures_util::stream::pending(), deadline(), "Copy")
            .await
            .unwrap_err();
        assert!(error.contains("acceptance was not confirmed"));
        assert!(!error.starts_with("DISCONNECTED:"));
    }

    #[tokio::test]
    async fn mutation_fallback_only_runs_when_execution_definitely_did_not_start() {
        assert!(mutation_with_safe_fallback(async { Ok(true) }, async {
            panic!("must not replay successful copy")
        })
        .await
        .is_ok());
        for error in [
            "Copy timed out",
            "Missing exit status",
            "Nonzero exit",
            "Transport lost",
        ] {
            assert_eq!(
                mutation_with_safe_fallback(async { Err(error.to_string()) }, async {
                    panic!("must not replay uncertain/partial copy")
                })
                .await,
                Err(error.to_string())
            );
        }
        assert_eq!(
            mutation_with_safe_fallback(async { Ok(false) }, async {
                Err("fallback ran".to_string())
            })
            .await,
            Err("fallback ran".to_string())
        );
    }

    #[tokio::test]
    async fn failed_directory_creation_requires_a_confirmed_existing_directory() {
        assert!(
            ensure_directory(async { Ok(()) }, async { panic!("probe not needed") })
                .await
                .is_ok()
        );
        assert!(
            ensure_directory(async { Err("mkdir denied".into()) }, async { Ok(true) })
                .await
                .is_ok()
        );
        for probe in [Ok(false), Err("lstat denied".to_string())] {
            assert_eq!(
                ensure_directory(async { Err("mkdir denied".into()) }, async { probe }).await,
                Err("mkdir denied".to_string())
            );
        }
    }

    #[tokio::test]
    async fn invalid_registration_and_missing_cancellation_are_rejected() {
        let registry = registry();
        assert!(request_cancel(&registry, "missing").await.is_err());
        assert!(start_transfer(
            registry.clone(),
            String::new(),
            false,
            |_| async { panic!("invalid registration must not run") },
            |_| {},
        )
        .await
        .is_err());
        assert!(registry.lock().await.is_empty());
    }

    #[tokio::test]
    async fn background_acceptance_precedes_completion_but_keeps_cancellation_registered() {
        let registry = registry();
        let (release, blocked) = oneshot::channel();
        let (notified, outcome) = oneshot::channel();
        start_transfer(
            registry.clone(),
            "background".into(),
            false,
            move |token| async move {
                blocked.await.unwrap();
                check_cancelled(&token)
            },
            move |result| {
                let _ = notified.send(result.clone());
            },
        )
        .await
        .unwrap();
        assert!(registry.lock().await.contains_key("background"));
        request_cancel(&registry, "background").await.unwrap();
        release.send(()).unwrap();
        assert_eq!(outcome.await.unwrap(), Err("Cancelled".into()));
        assert!(registry.lock().await.is_empty());
    }

    #[tokio::test]
    async fn completion_waiter_does_not_finish_at_acceptance() {
        let registry = registry();
        let (started, running) = oneshot::channel();
        let (release, blocked) = oneshot::channel();
        let (notified, outcome) = oneshot::channel();
        let waiter = tokio::spawn(start_transfer(
            registry.clone(),
            "awaited".into(),
            true,
            move |_| async move {
                started.send(()).unwrap();
                blocked.await.unwrap();
                Ok(())
            },
            move |result| {
                let _ = notified.send(result.clone());
            },
        ));
        running.await.unwrap();
        assert!(!waiter.is_finished());
        release.send(()).unwrap();
        assert_eq!(waiter.await.unwrap(), Ok(()));
        assert_eq!(outcome.await.unwrap(), Ok(()));
        assert!(registry.lock().await.is_empty());
        assert!(request_cancel(&registry, "awaited").await.is_err());
    }

    #[tokio::test]
    async fn duplicate_id_does_not_replace_the_running_operation() {
        let registry = registry();
        let (release, blocked) = oneshot::channel();
        let (notified, outcome) = oneshot::channel();
        start_transfer(
            registry.clone(),
            "same".into(),
            false,
            move |token| async move {
                blocked.await.unwrap();
                check_cancelled(&token)
            },
            move |result| {
                let _ = notified.send(result.clone());
            },
        )
        .await
        .unwrap();
        assert!(start_transfer(
            registry.clone(),
            "same".into(),
            false,
            |_| async { panic!("duplicate must not run") },
            |_| {},
        )
        .await
        .is_err());
        request_cancel(&registry, "same").await.unwrap();
        release.send(()).unwrap();
        assert_eq!(outcome.await.unwrap(), Err("Cancelled".into()));
    }

    #[tokio::test]
    async fn failures_and_panics_are_terminal_and_remove_registration() {
        for should_panic in [false, true] {
            let registry = registry();
            let (notified, outcome) = oneshot::channel();
            let result = start_transfer(
                registry.clone(),
                "failure".into(),
                true,
                move |_| async move {
                    if should_panic {
                        panic!("test task panic")
                    }
                    Err("write failed".to_string())
                },
                move |result| {
                    let _ = notified.send(result.clone());
                },
            )
            .await;
            assert!(result.is_err());
            assert_eq!(outcome.await.unwrap(), result);
            assert!(registry.lock().await.is_empty());
        }
    }

    #[tokio::test]
    async fn cancellation_requested_after_work_does_not_replace_success() {
        let registry = registry();
        let (written, writing_done) = oneshot::channel();
        let (release, blocked) = oneshot::channel();
        let (notified, outcome) = oneshot::channel();
        start_transfer(
            registry.clone(),
            "finished".into(),
            false,
            move |_| async move {
                written.send(()).unwrap();
                blocked.await.unwrap();
                Ok(())
            },
            move |result| {
                let _ = notified.send(result.clone());
            },
        )
        .await
        .unwrap();
        writing_done.await.unwrap();
        request_cancel(&registry, "finished").await.unwrap();
        release.send(()).unwrap();
        assert_eq!(outcome.await.unwrap(), Ok(()));
    }

    #[tokio::test]
    async fn dropping_the_waiter_does_not_cancel_the_owned_operation() {
        let registry = registry();
        let (started, running) = oneshot::channel();
        let (release, blocked) = oneshot::channel();
        let (notified, outcome) = oneshot::channel();
        let waiter = tokio::spawn(start_transfer(
            registry.clone(),
            "owned".into(),
            true,
            move |_| async move {
                started.send(()).unwrap();
                blocked.await.unwrap();
                Ok(())
            },
            move |result| {
                let _ = notified.send(result.clone());
            },
        ));
        running.await.unwrap();
        waiter.abort();
        assert!(waiter.await.unwrap_err().is_cancelled());
        release.send(()).unwrap();
        assert_eq!(outcome.await.unwrap(), Ok(()));
        assert!(registry.lock().await.is_empty());
    }

    struct ClosingWriter {
        closed: bool,
        fail_close: bool,
        close_gate: Option<oneshot::Receiver<()>>,
        close_started: Option<oneshot::Sender<()>>,
    }

    impl AsyncWrite for ClosingWriter {
        fn poll_write(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
            data: &[u8],
        ) -> Poll<io::Result<usize>> {
            Poll::Ready(Ok(data.len()))
        }
        fn poll_flush(self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<io::Result<()>> {
            Poll::Ready(Ok(()))
        }
        fn poll_shutdown(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
            if let Some(started) = self.close_started.take() {
                let _ = started.send(());
            }
            if let Some(gate) = self.close_gate.as_mut() {
                // The real destination may still be acknowledging its final write/close.
                match Pin::new(gate).poll(cx) {
                    Poll::Pending => return Poll::Pending,
                    Poll::Ready(Err(_)) => {
                        return Poll::Ready(Err(io::Error::other("close interrupted")))
                    }
                    Poll::Ready(Ok(())) => {}
                }
            }
            self.closed = true;
            Poll::Ready(if self.fail_close {
                Err(io::Error::other("close rejected"))
            } else {
                Ok(())
            })
        }
    }

    #[tokio::test]
    async fn destination_close_is_awaited_and_its_error_is_not_success() {
        for fail_close in [false, true] {
            let mut writer = ClosingWriter {
                closed: false,
                fail_close,
                close_gate: None,
                close_started: None,
            };
            let result = finish_writer(&mut writer).await;
            assert!(writer.closed);
            assert_eq!(result.is_err(), fail_close);
        }
    }

    #[tokio::test]
    async fn failed_copy_stops_reader_and_close_failure_is_not_confirmed_cancellation() {
        for fail_close in [false, true] {
            let (started, reading) = oneshot::channel();
            let reader = tokio::spawn(async move {
                started.send(()).unwrap();
                std::future::pending::<()>().await;
            });
            let abort_handle = reader.abort_handle();
            reading.await.unwrap();
            let mut writer = ClosingWriter {
                closed: false,
                fail_close,
                close_gate: None,
                close_started: None,
            };
            let result = finish_pipeline(&mut writer, reader, Err("Cancelled".into())).await;
            assert!(abort_handle.is_finished());
            assert!(writer.closed);
            let error = result.unwrap_err();
            if fail_close {
                assert!(
                    error.contains("Cancelled; Failed to finish destination file: close rejected")
                );
                assert_ne!(error, "Cancelled");
            } else {
                assert_eq!(error, "Cancelled");
            }
        }
    }

    #[tokio::test]
    async fn reader_panic_cannot_look_like_successful_end_of_input() {
        let reader = tokio::spawn(async { panic!("source reader panic") });
        let mut writer = ClosingWriter {
            closed: false,
            fail_close: false,
            close_gate: None,
            close_started: None,
        };
        assert!(finish_pipeline(&mut writer, reader, Ok(())).await.is_err());
        assert!(writer.closed);
    }

    #[tokio::test]
    async fn completion_waits_until_destination_close_finishes() {
        let (started, closing) = oneshot::channel();
        let (release, blocked) = oneshot::channel();
        let (notified, mut outcome) = oneshot::channel();
        let waiter = tokio::spawn(start_transfer(
            registry(),
            "closing".into(),
            true,
            move |_| async move {
                let mut writer = ClosingWriter {
                    closed: false,
                    fail_close: false,
                    close_gate: Some(blocked),
                    close_started: Some(started),
                };
                finish_writer(&mut writer).await
            },
            move |result| {
                let _ = notified.send(result.clone());
            },
        ));
        closing.await.unwrap();
        assert!(!waiter.is_finished());
        assert_eq!(outcome.try_recv(), Err(oneshot::error::TryRecvError::Empty));
        release.send(()).unwrap();
        assert_eq!(waiter.await.unwrap(), Ok(()));
        assert_eq!(outcome.await.unwrap(), Ok(()));
    }
}
