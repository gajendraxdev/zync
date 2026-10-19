//! Bounded native-to-xterm delivery. Credit is restored only by parser ACKs.
//!
//! The sender is cancellation-safe between frames and independent of input or
//! resize. There is no inactivity timeout: a minimized/suspended renderer must
//! not lose its shell merely because it has stopped parsing for a while.

use crate::{pty_output_flush::encode_output_frame, terminal_output::OutputWindow};
use anyhow::{anyhow, Result};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::ipc::{Channel, InvokeResponseBody};
use tokio::sync::Notify;

/// Starting wire budget, to be qualified with throughput and input-latency tests.
pub(crate) const OUTPUT_WINDOW_BYTES: usize = 256 * 1024;
/// Frame-count cap also bounds bookkeeping for tiny interactive writes.
pub(crate) const OUTPUT_WINDOW_FRAMES: usize = 64;
/// A strict per-frame payload cap, distinct from the native batching threshold.
pub(crate) const OUTPUT_FRAME_BYTES: usize = 16 * 1024;

/// Progress through a logical flush; retained when a select branch is cancelled.
#[derive(Default)]
pub(crate) struct OutputCursor {
    bytes: Vec<u8>,
    offset: usize,
}

impl OutputCursor {
    /// Own a single bounded flush without copying its full contents again.
    pub(crate) fn new(bytes: Vec<u8>) -> Self {
        Self { bytes, offset: 0 }
    }
    /// Whether this flush has been fully emitted (not necessarily parsed yet).
    pub(crate) fn is_empty(&self) -> bool {
        self.offset == self.bytes.len()
    }
}

/// One PTY generation and output-channel owner, with a shared pure byte ledger.
pub(crate) struct PtyOutput {
    channel: Channel,
    generation: u32,
    window: Mutex<OutputWindow>,
    changed: Notify,
    closed: AtomicBool,
}

impl PtyOutput {
    /// Bind accounting to the exact channel passed to terminal creation.
    pub(crate) fn new(channel: Channel, generation: u32) -> Self {
        Self {
            channel,
            generation,
            window: Mutex::new(OutputWindow::new(
                OUTPUT_WINDOW_BYTES,
                OUTPUT_WINDOW_FRAMES,
                8,
            )),
            changed: Notify::new(),
            closed: AtomicBool::new(false),
        }
    }

    /// Reject ACKs from an obsolete channel even if a terminal ID is reused.
    pub(crate) fn matches(&self, generation: u32, channel_id: u32) -> bool {
        self.generation == generation && self.channel.id() == channel_id
    }

    /// Apply validated cumulative parser progress and wake the output sender.
    pub(crate) fn acknowledge(&self, sequence: u32) -> Result<()> {
        let mut window = self
            .window
            .lock()
            .map_err(|_| anyhow!("Terminal output accounting unavailable"))?;
        window.acknowledge(sequence).map_err(|e| anyhow!(e))?;
        drop(window);
        self.changed.notify_one();
        Ok(())
    }

    /// Cancel credit/drain waits before platform teardown; never forge an ACK.
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
        self.changed.notify_waiters();
    }

    /// Send ordered bounded frames. Advancing the cursor and dispatching a
    /// reserved frame have no intervening await, so select cancellation cannot
    /// duplicate, skip or reserve credit for a frame that was never dispatched.
    pub(crate) async fn send_pending(&self, cursor: &mut OutputCursor) -> Result<()> {
        while !cursor.is_empty() {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.closed.load(Ordering::Acquire) {
                return Err(anyhow!("Terminal output closed"));
            }
            let count = (cursor.bytes.len() - cursor.offset).min(OUTPUT_FRAME_BYTES);
            let sequence = {
                let mut window = self
                    .window
                    .lock()
                    .map_err(|_| anyhow!("Terminal output accounting unavailable"))?;
                if window.can_send(count) {
                    Some(
                        window
                            .reserve(count, std::time::Instant::now())
                            .map_err(|e| anyhow!(e))?,
                    )
                } else {
                    None
                }
            };
            if let Some(sequence) = sequence {
                let frame = encode_output_frame(
                    self.generation,
                    sequence,
                    &cursor.bytes[cursor.offset..cursor.offset + count],
                );
                self.channel
                    .send(InvokeResponseBody::Raw(frame))
                    .map_err(|e| anyhow!("Terminal output delivery failed: {}", e))?;
                cursor.offset += count;
            } else {
                changed.await;
            }
        }
        // Release the logical flush allocation even when a long-lived PTY goes idle.
        cursor.bytes = Vec::new();
        cursor.offset = 0;
        Ok(())
    }

    /// Natural exit waits until the final frame has reached xterm's parser.
    /// Explicit close/dispose instead calls close() and cancels this wait.
    pub(crate) async fn drain(&self) -> Result<()> {
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if self.closed.load(Ordering::Acquire) {
                return Err(anyhow!("Terminal output closed"));
            }
            if self
                .window
                .lock()
                .map_err(|_| anyhow!("Terminal output accounting unavailable"))?
                .is_empty()
            {
                return Ok(());
            }
            changed.await;
        }
    }

    /// Pending wire bytes for bounded-buffer regression tests and diagnostics.
    #[cfg(test)]
    fn pending_bytes(&self) -> usize {
        self.window.lock().unwrap().pending_bytes()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// Record native frames without a webview, real shell, network or credentials.
    fn fixture() -> (
        Arc<PtyOutput>,
        tokio::sync::mpsc::UnboundedReceiver<Vec<u8>>,
    ) {
        let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Raw(bytes) = body {
                tx.send(bytes).unwrap();
            }
            Ok(())
        });
        (Arc::new(PtyOutput::new(channel, 17)), rx)
    }

    #[tokio::test]
    async fn slow_parser_bounds_window_and_preserves_every_byte() {
        let (output, mut frames) = fixture();
        let bytes: Vec<_> = (0..OUTPUT_WINDOW_BYTES * 8)
            .map(|i| (i % 251) as u8)
            .collect();
        let expected = bytes.clone();
        let producer = output.clone();
        let task = tokio::spawn(async move {
            producer
                .send_pending(&mut OutputCursor::new(bytes))
                .await
                .unwrap();
            producer.drain().await.unwrap();
        });
        let mut parsed = Vec::new();
        let mut sequence = 0;
        while parsed.len() < expected.len() {
            let frame = frames.recv().await.unwrap();
            assert_eq!(u32::from_le_bytes(frame[..4].try_into().unwrap()), 17);
            sequence += 1;
            assert_eq!(
                u32::from_le_bytes(frame[4..8].try_into().unwrap()),
                sequence
            );
            assert!(frame.len() <= OUTPUT_FRAME_BYTES + 8);
            assert!(output.pending_bytes() <= OUTPUT_WINDOW_BYTES);
            tokio::task::yield_now().await; // deliberately delay parser completion
            parsed.extend_from_slice(&frame[8..]);
            output.acknowledge(sequence).unwrap();
            output.acknowledge(sequence).unwrap(); // duplicate never releases more
        }
        task.await.unwrap();
        assert_eq!(parsed, expected);
        assert_eq!(output.pending_bytes(), 0);
    }

    #[tokio::test]
    async fn full_window_can_be_cancelled_without_waiting_for_parser() {
        let (output, mut frames) = fixture();
        let producer = output.clone();
        let task = tokio::spawn(async move {
            producer
                .send_pending(&mut OutputCursor::new(vec![0; OUTPUT_WINDOW_BYTES * 2]))
                .await
        });
        frames.recv().await.unwrap();
        assert!(output.acknowledge(u32::MAX).is_err());
        output.close();
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap()
                .is_err()
        );
    }

    #[tokio::test]
    async fn final_output_requires_ack_but_close_releases_drain() {
        let (output, mut frames) = fixture();
        output
            .send_pending(&mut OutputCursor::new(b"tail".to_vec()))
            .await
            .unwrap();
        frames.recv().await.unwrap();
        let waiting = output.clone();
        let task = tokio::spawn(async move { waiting.drain().await });
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        output.close();
        assert!(task.await.unwrap().is_err());
    }
}
