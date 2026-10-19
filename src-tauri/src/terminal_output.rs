//! Transport-neutral accounting for parser-acknowledged terminal output.
//!
//! A full window is a policy decision: ordinary terminals wait for credit;
//! plugin terminals retain their own overload/authority policy. Neither path
//! may grant credit for bytes that have not been parsed by its terminal sink.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// The exact outstanding cost of one sequenced wire frame.
struct OutstandingFrame {
    sequence: u32,
    wire_bytes: usize,
    payload_bytes: usize,
    sent_at: Instant,
}

/// Bounded cumulative sequence ledger; it does not perform I/O or impose timers.
pub(crate) struct OutputWindow {
    next: u32,
    acknowledged: u32,
    bytes: usize,
    max_bytes: usize,
    max_frames: usize,
    header_bytes: usize,
    frames: VecDeque<OutstandingFrame>,
}

impl OutputWindow {
    /// Construct a session-local ledger with explicit byte and frame budgets.
    pub(crate) fn new(max_bytes: usize, max_frames: usize, header_bytes: usize) -> Self {
        assert!(max_bytes > header_bytes && max_frames > 0);
        Self {
            next: 0,
            acknowledged: 0,
            bytes: 0,
            max_bytes,
            max_frames,
            header_bytes,
            frames: VecDeque::new(),
        }
    }

    /// Whether all emitted frames have been acknowledged by the parser.
    pub(crate) fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }

    /// Current wire bytes retained across the transport/parser boundary.
    #[cfg(test)]
    pub(crate) fn pending_bytes(&self) -> usize {
        self.bytes
    }

    /// Check capacity without allocating a frame or advancing its sequence.
    pub(crate) fn can_send(&self, payload_bytes: usize) -> bool {
        payload_bytes
            .checked_add(self.header_bytes)
            .is_some_and(|bytes| bytes <= self.max_bytes.saturating_sub(self.bytes))
            && self.frames.len() < self.max_frames
    }

    /// Reserve exact wire cost before emission; a failed reservation is inert.
    pub(crate) fn reserve(&mut self, payload_bytes: usize, now: Instant) -> Result<u32, String> {
        if !self.can_send(payload_bytes) {
            return Err("Terminal output exceeded the renderer window".into());
        }
        let sequence = self
            .next
            .checked_add(1)
            .ok_or("Terminal output sequence exhausted")?;
        let wire_bytes = payload_bytes + self.header_bytes;
        self.frames.push_back(OutstandingFrame {
            sequence,
            wire_bytes,
            payload_bytes,
            sent_at: now,
        });
        self.next = sequence;
        self.bytes += wire_bytes;
        Ok(sequence)
    }

    /// Acknowledge a contiguous prefix once, returning only newly parsed payload
    /// bytes. Duplicate ACKs never mint credit; stale/future values are rejected.
    pub(crate) fn acknowledge(&mut self, sequence: u32) -> Result<usize, String> {
        if sequence == self.acknowledged {
            return Ok(0);
        }
        if sequence < self.acknowledged || sequence > self.next {
            return Err("Invalid terminal output acknowledgement".into());
        }
        let mut parsed_bytes = 0;
        while self
            .frames
            .front()
            .is_some_and(|frame| frame.sequence <= sequence)
        {
            let frame = self.frames.pop_front().expect("front was present");
            self.bytes -= frame.wire_bytes;
            parsed_bytes += frame.payload_bytes;
        }
        self.acknowledged = sequence;
        Ok(parsed_bytes)
    }

    /// Optional age policy for callers that explicitly require an ACK timeout.
    pub(crate) fn stalled(&self, now: Instant, timeout: Duration) -> bool {
        self.frames
            .front()
            .is_some_and(|frame| now.saturating_duration_since(frame.sent_at) >= timeout)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cumulative_ack_releases_exact_wire_cost_without_duplicate_credit() {
        let mut window = OutputWindow::new(32, 3, 8);
        let now = Instant::now();
        assert_eq!(window.reserve(3, now).unwrap(), 1);
        assert_eq!(window.reserve(4, now).unwrap(), 2);
        assert_eq!(window.pending_bytes(), 23);
        assert_eq!(window.acknowledge(2).unwrap(), 7);
        assert_eq!(window.acknowledge(2).unwrap(), 0);
        assert!(window.acknowledge(1).is_err());
        assert!(window.acknowledge(3).is_err());
        assert!(window.is_empty());
        assert_eq!(window.pending_bytes(), 0);
    }

    #[test]
    fn failed_reservations_do_not_advance_sequence_or_bypass_limits() {
        let mut window = OutputWindow::new(24, 2, 8);
        let now = Instant::now();
        assert!(window.reserve(usize::MAX, now).is_err());
        assert_eq!(window.reserve(4, now).unwrap(), 1);
        assert_eq!(window.reserve(4, now).unwrap(), 2);
        assert!(window.reserve(0, now).is_err());
        window.acknowledge(1).unwrap();
        assert_eq!(window.reserve(4, now).unwrap(), 3);
        assert!(window.pending_bytes() <= 24);
    }

    #[test]
    fn frame_count_also_bounds_tiny_packets_and_timeout_is_optional() {
        let mut window = OutputWindow::new(1024, 2, 4);
        let now = Instant::now();
        window.reserve(1, now).unwrap();
        window.reserve(0, now).unwrap();
        assert!(!window.can_send(1));
        assert!(window.stalled(now + Duration::from_secs(5), Duration::from_secs(5)));
        window.acknowledge(2).unwrap();
        assert!(!window.stalled(now + Duration::from_secs(10), Duration::from_secs(5)));
    }
}
