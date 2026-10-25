//! Bounded nonce-framed stderr classification. Retain only a denial bit, never raw diagnostics.
use super::facts::{is_protected_read, Facts};
use std::collections::BTreeSet;
use zeroize::Zeroizing;

pub struct AccessEvidence {
    prefix: Vec<u8>,
    tail: Zeroizing<Vec<u8>>,
    active: Option<(String, bool)>,
    denied: BTreeSet<String>,
}
impl AccessEvidence {
    /// The fixed collector frames only protected reads; unrelated stderr cannot grant a badge.
    pub fn new(nonce: &str) -> Self {
        Self {
            prefix: format!("ZYNC-ACCESS-{nonce}-").into_bytes(),
            tail: Zeroizing::new(Vec::new()),
            active: None,
            denied: BTreeSet::new(),
        }
    }
    /// Recognize fixed C-locale denial messages across chunk boundaries using constant-sized scratch memory.
    pub fn feed(&mut self, bytes: &[u8]) -> Result<(), String> {
        for byte in bytes {
            self.tail.push(*byte);
            if let Some((_, denied)) = self.active.as_mut() {
                if [
                    b"Permission denied".as_slice(),
                    b"Operation not permitted",
                    b"you must be root",
                ]
                .iter()
                .any(|needle| {
                    self.tail
                        .len()
                        .checked_sub(needle.len())
                        .is_some_and(|start| self.tail[start..].eq_ignore_ascii_case(needle))
                }) {
                    *denied = true;
                }
            }
            if *byte == b':' {
                if let Some(start) = self
                    .tail
                    .windows(self.prefix.len())
                    .position(|value| value == self.prefix)
                {
                    let token = std::str::from_utf8(
                        &self.tail[start + self.prefix.len()..self.tail.len() - 1],
                    )
                    .unwrap_or("");
                    let (action, key) = token
                        .split_once('-')
                        .ok_or("The assessment access response could not be verified.")?;
                    if !is_protected_read(key) {
                        return Err(
                            "The assessment returned an unsupported access response.".into()
                        );
                    }
                    match action {
                        "begin" if self.active.is_none() => self.active = Some((key.into(), false)),
                        "end"
                            if self
                                .active
                                .as_ref()
                                .is_some_and(|(active, _)| active == key) =>
                        {
                            let (key, denied) = self.active.take().unwrap();
                            if denied {
                                self.denied.insert(key);
                            }
                        }
                        _ => {
                            return Err(
                                "The assessment returned access responses in an unexpected order."
                                    .into(),
                            )
                        }
                    }
                    self.tail.clear();
                }
            }
            if self.tail.len() > self.prefix.len() + 64 {
                self.tail.remove(0);
            }
        }
        Ok(())
    }
    /// Normalize only failed reads; tool absence, timeouts and successful/malformed evidence stay distinct.
    pub fn apply(self, facts: &mut Facts) {
        for key in self.denied {
            if let Some(fact) = facts.0.get_mut(&key) {
                if fact.status != 0 && !matches!(fact.status, 124 | 126 | 127 | 137) {
                    fact.status = 77;
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::security::facts::Fact;
    use std::collections::BTreeMap;
    /// Only a complete owned frame plus failed command and unelevated user can produce the access badge.
    #[test]
    fn permission_badges_do_not_guess_from_exit_codes() {
        for key in ["nft", "ssh_defaults"] {
            for (status, text, expected) in [
                (1, "Permission denied", true),
                (1, "sysctl: permission denied on key", true),
                (1, "Operation not permitted", true),
                (1, "invalid configuration", false),
                (1, "/etc/ssh/sshd_config: Permission denied", true),
                (1, "sshd: no hostkeys available -- exiting.", false),
                (1, "Unable to load host key: /fixture/key", false),
                (1, "Bad configuration option: FixtureInvalid", false),
                (127, "Permission denied", false),
                (126, "Permission denied", false),
                (124, "Permission denied", false),
                (137, "Permission denied", false),
                (0, "Permission denied", false),
            ] {
                let mut facts = Facts(BTreeMap::from([
                    (
                        "privilege".into(),
                        Fact {
                            status: 0,
                            output: "1000 user".into(),
                        },
                    ),
                    (
                        key.into(),
                        Fact {
                            status,
                            output: String::new(),
                        },
                    ),
                ]));
                let mut evidence = AccessEvidence::new("nonce");
                let frame = format!("unframed Permission denied ZYNC-ACCESS-nonce-begin-{key}:{text}ZYNC-ACCESS-nonce-end-{key}:");
                for chunk in frame.as_bytes().chunks(3) {
                    evidence.feed(chunk).unwrap();
                }
                evidence.apply(&mut facts);
                assert_eq!(facts.needs_elevated_access(key), expected);
                if key == "ssh_defaults" {
                    facts.0.insert(
                        "os".into(),
                        Fact {
                            status: 0,
                            output: "ID=ubuntu\nVERSION_ID=24.04".into(),
                        },
                    );
                    let report = crate::security::hardening::assess(&facts).unwrap();
                    let ssh: Vec<_> = report
                        .findings
                        .iter()
                        .filter(|finding| finding.id.starts_with("SSH-"))
                        .collect();
                    assert_eq!(ssh.len(), 8);
                    assert!(ssh.iter().all(|finding| finding.status == "notAssessed"
                        && finding.needs_elevated_access == expected));
                }
                for privilege in ["1000 sudo", "0 user", "0 sudo", "garbage"] {
                    facts.0.get_mut("privilege").unwrap().output = privilege.into();
                    assert!(!facts.needs_elevated_access(key));
                }
            }
        }
        let mut unframed = AccessEvidence::new("nonce");
        unframed
            .feed(b"ZYNC-ACCESS-wrong-begin-nft:Permission deniedZYNC-ACCESS-wrong-end-nft:")
            .unwrap();
        assert!(unframed.denied.is_empty());
        let mut incomplete = AccessEvidence::new("nonce");
        incomplete
            .feed(b"ZYNC-ACCESS-nonce-begin-nft:Permission denied")
            .unwrap();
        assert!(
            incomplete.denied.is_empty(),
            "An unfinished frame cannot classify a failure"
        );
    }
}
