//! Wire limits are enforced natively, independently of the host UI and SDK.
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

pub const MAX_TERMINALS: usize = 8;
pub const MAX_PER_RUNTIME: usize = 4;
pub const MAX_DOCUMENTS: usize = 64;
pub const OFFER_LIFETIME: Duration = Duration::from_secs(60);
pub const INPUT_BYTES: usize = 4096;
pub const INPUT_PACKETS: usize = 16;
pub const OUTPUT_BYTES: usize = 128 * 1024;
pub const OUTPUT_FRAMES: usize = 64;
pub const ACK_TIMEOUT: Duration = Duration::from_secs(5);
pub const OUTPUT_BATCH_BYTES: usize = 16 * 1024;
pub const OUTPUT_FLUSH: Duration = Duration::from_millis(12);

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Launch {
    pub program: String,
    pub args: Vec<String>,
    pub expected_connection_token: String,
}

impl Launch {
    /// POSIX argv quoting prevents interpolation; explicit shells still allow
    /// arbitrary remote code. Approval must display the original argv.
    pub fn command_line(&self) -> Result<String, String> {
        if self.program.trim().is_empty() || self.program.starts_with('-') || self.args.len() > 64 {
            return Err("Invalid terminal program or argument count".into());
        }
        if self.expected_connection_token.is_empty()
            || self.expected_connection_token.len() > 256
            || self.expected_connection_token.chars().any(char::is_control)
        {
            return Err("Invalid terminal connection token".into());
        }
        let mut bytes = 0usize;
        let mut quoted = Vec::new();
        for value in std::iter::once(&self.program).chain(self.args.iter()) {
            bytes = bytes.saturating_add(value.len());
            if bytes > 16 * 1024 || value.chars().any(char::is_control) {
                return Err("Terminal arguments contain controls or exceed 16 KiB".into());
            }
            quoted.push(format!("'{}'", value.replace('\'', "'\\''")));
        }
        Ok(quoted.join(" "))
    }
}

#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Size {
    pub cols: u32,
    pub rows: u32,
}

impl Size {
    pub fn validate(self) -> Result<Self, String> {
        if !(1..=1000).contains(&self.cols) || !(1..=1000).contains(&self.rows) {
            return Err("Terminal dimensions must be between 1 and 1000 cells".into());
        }
        Ok(self)
    }
}

/// Cumulative acknowledgements release exact wire bytes. Plugin sessions retain
/// their overload-close policy: pausing an ordinary SSH receive queue can block
/// the shared connection actor. Ordinary shells use separate parser-credit waits.
pub struct OutputWindow(crate::terminal_output::OutputWindow);

impl Default for OutputWindow {
    /// Retain plugin wire budgets independently of ordinary-terminal policy.
    fn default() -> Self {
        Self(crate::terminal_output::OutputWindow::new(
            OUTPUT_BYTES,
            OUTPUT_FRAMES,
            4,
        ))
    }
}

impl OutputWindow {
    /// Whether final plugin output has been parsed before detach.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// Reserve shared accounting while retaining the plugin's sequence-only wire.
    pub fn frame(&mut self, data: &[u8], now: Instant) -> Result<Vec<u8>, String> {
        let sequence = self.0.reserve(data.len(), now)?;
        let bytes = data.len() + 4;
        let mut frame = Vec::with_capacity(bytes);
        frame.extend_from_slice(&sequence.to_le_bytes());
        frame.extend_from_slice(data);
        Ok(frame)
    }

    /// Apply cumulative parser credit without changing plugin authority checks.
    pub fn acknowledge(&mut self, sequence: u32) -> Result<(), String> {
        self.0.acknowledge(sequence).map(|_| ())
    }

    /// Plugins keep their explicit timeout; ordinary terminals do not inherit it.
    pub fn stalled(&self, now: Instant) -> bool {
        self.0.stalled(now, ACK_TIMEOUT)
    }
}

/// Coalesce tiny SSH packets without an unbounded staging buffer or one IPC per
/// byte. The renderer still acknowledges each emitted binary frame separately.
#[derive(Default)]
pub struct OutputBatch(Vec<u8>);

impl OutputBatch {
    pub fn push(
        &mut self,
        mut data: &[u8],
        window: &mut OutputWindow,
        mut emit: impl FnMut(Vec<u8>) -> Result<(), String>,
    ) -> Result<(), String> {
        while !data.is_empty() {
            let count = data.len().min(OUTPUT_BATCH_BYTES - self.0.len());
            self.0.extend_from_slice(&data[..count]);
            data = &data[count..];
            if self.0.len() == OUTPUT_BATCH_BYTES {
                self.flush(window, &mut emit)?;
            }
        }
        Ok(())
    }

    pub fn flush(
        &mut self,
        window: &mut OutputWindow,
        mut emit: impl FnMut(Vec<u8>) -> Result<(), String>,
    ) -> Result<(), String> {
        if self.0.is_empty() {
            return Ok(());
        }
        let frame = window.frame(&self.0, Instant::now())?;
        self.0.clear();
        emit(frame)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn launch() -> Launch {
        Launch {
            program: "docker".into(),
            args: vec!["a'; $(bad)".into(), "".into()],
            expected_connection_token: "lease:1".into(),
        }
    }

    #[test]
    fn quotes_argv_and_rejects_authority_fields() {
        assert_eq!(
            launch().command_line().unwrap(),
            "'docker' 'a'\\''; $(bad)' ''"
        );
        assert!(serde_json::from_value::<Launch>(serde_json::json!({"program":"sh","args":[],"expectedConnectionToken":"x","connectionId":"other"})).is_err());
        for args in [
            vec!["\n".into()],
            vec!["a".repeat(16385)],
            vec!["x".into(); 65],
        ] {
            assert!(Launch { args, ..launch() }.command_line().is_err());
        }
    }

    #[test]
    fn bounded_output_and_exact_cumulative_credit() {
        let now = Instant::now();
        let mut window = OutputWindow::default();
        assert_eq!(
            window.frame(b"abc", now).unwrap(),
            vec![1, 0, 0, 0, b'a', b'b', b'c']
        );
        assert!(window.acknowledge(2).is_err());
        assert!(window.stalled(now + ACK_TIMEOUT));
        window.acknowledge(1).unwrap();
        window.acknowledge(1).unwrap();
        assert_eq!(window.0.pending_bytes(), 0);
        assert!(!window.stalled(now + ACK_TIMEOUT));
        window.frame(&vec![0; OUTPUT_BYTES - 4], now).unwrap();
        assert!(window.frame(b"x", now).is_err());
        window.acknowledge(2).unwrap();
        for _ in 0..OUTPUT_FRAMES {
            window.frame(b"x", now).unwrap();
        }
        assert!(window.frame(b"x", now).is_err());
        assert!(window.acknowledge(1).is_err());
    }

    #[test]
    fn dimensions_are_not_unbounded() {
        for size in [
            Size { cols: 0, rows: 24 },
            Size {
                cols: 80,
                rows: 1001,
            },
        ] {
            assert!(size.validate().is_err());
        }
        assert!(Size { cols: 80, rows: 24 }.validate().is_ok());
    }

    #[test]
    fn tiny_packets_are_batched_and_large_packets_stay_bounded() {
        let mut window = OutputWindow::default();
        let mut batch = OutputBatch::default();
        let mut frames = Vec::new();
        for _ in 0..1000 {
            batch
                .push(b"x", &mut window, |frame| {
                    frames.push(frame);
                    Ok(())
                })
                .unwrap();
        }
        assert!(frames.is_empty());
        batch
            .flush(&mut window, |frame| {
                frames.push(frame);
                Ok(())
            })
            .unwrap();
        assert_eq!(frames[0].len(), 1004);
        window.acknowledge(1).unwrap();
        assert!(batch
            .push(&vec![0; OUTPUT_BYTES * 2], &mut window, |_| Ok(()))
            .is_err());
        assert!(batch.0.len() <= OUTPUT_BATCH_BYTES);
        assert!(window.0.pending_bytes() <= OUTPUT_BYTES);
    }
}
