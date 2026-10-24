//! Run-bound sudo prompt recognition. No terminal echo, persistence or raw-error forwarding.
use super::facts::is_protected_read;
use std::collections::BTreeSet;
use zeroize::Zeroizing;

/// Passwords travel as one bounded stdin line, never a command argument or shell variable.
pub fn validate_password(password: &str) -> Result<(), String> {
    if password.is_empty() || password.len() > 4096 || password.contains(['\r', '\n', '\0']) {
        return Err("Enter a password of at most 4096 bytes without line breaks.".into());
    }
    Ok(())
}

pub struct Prompts {
    prefix: Vec<u8>,
    tail: Zeroizing<Vec<u8>>,
    seen: BTreeSet<String>,
    active: Option<String>,
}
impl Prompts {
    /// Each collector has a random nonce; only the seven fixed protected-call labels may request input.
    pub fn new(nonce: &str) -> Self {
        Self {
            prefix: format!("ZYNC-SUDO-{nonce}-").into_bytes(),
            tail: Zeroizing::new(Vec::new()),
            seen: BTreeSet::new(),
            active: None,
        }
    }

    /// Recognize split stderr prompts without retaining arbitrary stderr. Never answer a repeated challenge.
    pub fn feed(&mut self, bytes: &[u8]) -> Result<bool, String> {
        let mut requested = false;
        // Stream one byte at a time into a tiny rolling buffer; attacker-sized chunks cannot grow it.
        for byte in bytes {
            self.tail.push(*byte);
            if *byte == b':' {
                if let Some(start) = self
                    .tail
                    .windows(self.prefix.len())
                    .position(|value| value == self.prefix)
                {
                    let token = std::str::from_utf8(
                        &self.tail[start + self.prefix.len()..self.tail.len() - 1],
                    )
                    .unwrap_or("")
                    .to_owned();
                    let (key, completion) = if let Some(end) = token.strip_prefix("end-") {
                        let (key, status) = end
                            .rsplit_once('-')
                            .ok_or("Invalid sudo completion marker.")?;
                        (
                            key,
                            Some(
                                status
                                    .parse::<u8>()
                                    .map_err(|_| "Invalid sudo completion status.")?,
                            ),
                        )
                    } else {
                        (token.as_str(), None)
                    };
                    if !is_protected_read(key) {
                        return Err(
                            "Unsupported sudo authentication challenge. No password was sent."
                                .into(),
                        );
                    }
                    if let Some(status) = completion {
                        if self.active.as_deref() == Some(key) {
                            self.active = None;
                            if status != 0 {
                                return Err("The protected command or sudo authentication failed after password submission. The password was not replayed. No completed report was retained.".into());
                            }
                        }
                        self.tail.clear();
                        continue;
                    }
                    if self.active.is_some() || !self.seen.insert(key.into()) || requested {
                        return Err("Sudo authentication was not accepted. The password was not retried. MFA and TTY-only authentication are unsupported.".into());
                    }
                    requested = true;
                    self.active = Some(key.into());
                    self.tail.clear();
                }
            }
            if self.tail.len() > self.prefix.len() + 32 {
                self.tail.remove(0);
            }
        }
        if requested && !self.awaiting() {
            return Err("Sudo authentication request ended before password submission.".into());
        }
        Ok(requested)
    }

    /// A challenge ending while the human types must not receive a late password.
    pub fn awaiting(&self) -> bool {
        self.active.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// A split prompt can be answered once; unrelated output and wrong nonces never authorize a write.
    #[test]
    fn exact_prompt_and_no_password_replay() {
        let mut prompts = Prompts::new("nonce");
        assert!(!prompts.feed(b"ZYNC-SUDO-wrong-hardlinks:").unwrap());
        assert!(!prompts.feed(b"ZYNC-SUDO-nonce-hard").unwrap());
        assert!(prompts.feed(b"links:").unwrap());
        assert!(prompts.feed(b"ZYNC-SUDO-nonce-hardlinks:").is_err());
        let mut failed = Prompts::new("nonce");
        assert!(failed.feed(b"ZYNC-SUDO-nonce-hardlinks:").unwrap());
        assert!(
            failed
                .feed(b"ZYNC-SUDO-nonce-end-hardlinks-1:ZYNC-SUDO-nonce-symlinks:")
                .is_err(),
            "passwd_tries=1 cannot cause a replay to the next command"
        );
        let mut success = Prompts::new("nonce");
        assert!(success.feed(b"ZYNC-SUDO-nonce-hardlinks:").unwrap());
        assert!(!success.feed(b"ZYNC-SUDO-nonce-end-hardlinks-0:").unwrap());
        assert!(!success.awaiting());
        assert!(success.feed(b"ZYNC-SUDO-nonce-symlinks:").unwrap());
        assert!(Prompts::new("nonce")
            .feed(b"ZYNC-SUDO-nonce-arbitrary:")
            .is_err());
        assert!(Prompts::new("nonce")
            .feed(b"ZYNC-SUDO-nonce-hardlinks:ZYNC-SUDO-nonce-end-hardlinks-0:")
            .is_err());
        for value in ["", "one\ntwo", "one\r", "one\0"] {
            assert!(validate_password(value).is_err());
        }
        assert!(validate_password(&"x".repeat(4097)).is_err());
        assert!(validate_password("valid password").is_ok());
    }
}
