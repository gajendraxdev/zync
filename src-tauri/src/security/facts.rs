//! Strict decoding of bounded, nonce-bound read-only collector output.
use super::report::MAX_REPORT_BYTES;
use std::collections::BTreeMap;
pub const MAX_FACT_BYTES: usize = 512 * 1024;
pub struct Fact {
    pub output: String,
    pub status: u32,
}
pub struct Facts(pub BTreeMap<String, Fact>);
/// Share the fixed protected-read allowlist across access evidence, sudo prompts and retry eligibility.
pub(super) fn is_protected_read(key: &str) -> bool {
    matches!(
        key,
        "hardlinks"
            | "symlinks"
            | "ssh_defaults"
            | "shadow_empty"
            | "nft"
            | "iptables"
            | "ip6tables"
    )
}
impl Facts {
    /// A badge requires verified access denial on a protected read, a non-root user and no attempted sudo.
    pub fn needs_elevated_access(&self, key: &str) -> bool {
        self.can_retry_with_sudo(key) && self.0.get(key).is_some_and(|fact| fact.status == 77)
    }
    /// Offer an approved attempt for failed protected reads without claiming their cause is permission denial.
    pub fn can_retry_with_sudo(&self, key: &str) -> bool {
        is_protected_read(key)
            && self
                .0
                .get(key)
                .is_some_and(|fact| matches!(fact.status, 1..=123) && fact.status != 65)
            && self
                .get("privilege")
                .and_then(|value| value.strip_suffix(" user"))
                .and_then(|uid| uid.parse::<u32>().ok())
                .is_some_and(|uid| uid != 0)
    }
    /// Explain known collection failures without forwarding potentially sensitive command stderr.
    pub fn diagnostic(&self, key: &str) -> String {
        match self.0.get(key) {
            None => "No collector record is available for this check.".into(),
            Some(fact) => match fact.status {
                0 if fact.output.len() > MAX_FACT_BYTES => "Evidence exceeded this check's 512 KiB interpretation budget. No protection was inferred from oversized output.".into(),
                0 => "The command completed but its evidence was missing or malformed for this check.".into(),
                77 => if self.get("privilege").is_some_and(|value| value.ends_with(" sudo")) { "Access to required evidence was denied despite sudo authorization. Review server policy and access controls; authorization alone does not guarantee access.".into() } else { "Access to required evidence was denied. An approved elevated run may provide this evidence.".into() },
                126 => "The required system command could not be executed (exit 126).".into(),
                127 => "A required command is not installed or not on the fixed system PATH (exit 127).".into(),
                124 | 137 => "This check reached its protected-command deadline.".into(),
                status => format!("Collection exited with status {status}. Permissions, unsupported configuration or command validation may be responsible; stderr is withheld.{}", if self.get("privilege").is_some_and(|value| value.ends_with(" sudo")) { " Sudo was authorized, but authorization or the command may have failed. This is not a failed security check." } else { " This run did not request sudo; protected checks may need an approved elevated run." }),
            },
        }
    }
    /// Unavailable checks need collection follow-up, never a configuration change inferred from absent evidence.
    pub fn collection_next_step(&self, key: &str) -> &'static str {
        if self.needs_elevated_access(key) {
            return "If authorized, use Retry with sudo to rerun the full hardening assessment and collect this protected evidence. Do not change security settings based on this unavailable check.";
        }
        if self.can_retry_with_sudo(key) {
            return "Resolve the collection failure described in Evidence with the host administrator. If authorized, Try with sudo reruns the full hardening assessment; it may help collect this protected evidence, but permission denial is not confirmed and success is not guaranteed. Do not change security settings based on this unavailable check.";
        }
        match self.0.get(key).map(|fact| fact.status) {
            Some(77) => "Review the access restriction with the host administrator, then rerun the assessment. Do not weaken access controls or assume sudo authorization guarantees access.",
            Some(126) => "Review why the required collector command could not execute under the host's policy, then rerun the assessment. No security configuration change is justified by this unavailable evidence.",
            Some(127) => "Check whether the required collector tool is available in standard system paths, then rerun the assessment. A missing collector does not establish a security weakness.",
            Some(124 | 137) => "Investigate why this collector reached its deadline before rerunning the assessment. Do not change security settings based on this unavailable check.",
            Some(0) => "Review the missing, malformed or unsupported collector output with the host administrator, then rerun the assessment. No security configuration change can be inferred from this evidence.",
            None => "Rerun the assessment to obtain this check's collector record. If it remains unavailable, review collector support with the host administrator before drawing conclusions.",
            _ => "Resolve the collection failure described in Evidence with the host administrator, then rerun the assessment. Do not change security settings based on this unavailable check.",
        }
    }
    /// Reject failed or oversized evidence before trimming; every rule shares the interpretation budget.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0
            .get(key)
            .filter(|fact| fact.status == 0 && fact.output.len() <= MAX_FACT_BYTES)
            .map(|fact| fact.output.trim())
    }
    /// Read os-release as data; never source a remote file as shell code.
    pub fn os(&self) -> Result<(String, String), String> {
        let source = self
            .get("os")
            .ok_or("Could not read the host's OS identity.")?;
        let field = |key: &str| -> Option<String> {
            let values: Vec<_> = source
                .lines()
                .filter_map(|line| line.strip_prefix(key))
                .collect();
            if values.len() != 1 {
                return None;
            }
            let value = values[0].trim_matches(['"', '\'']);
            (!value.is_empty()
                && value.len() <= 32
                && value
                    .bytes()
                    .all(|ch| ch.is_ascii_alphanumeric() || b"._-".contains(&ch)))
            .then(|| value.into())
        };
        Ok((
            field("ID=").ok_or("Invalid OS identity.")?,
            field("VERSION_ID=").unwrap_or_default(),
        ))
    }
}
/// Reject truncated, duplicate, unsolicited or over-budget records before evaluating checks.
pub fn decode(bytes: &[u8], nonce: &str, keys: &[&str]) -> Result<Facts, String> {
    if bytes.len() > MAX_REPORT_BYTES {
        return Err("Assessment output exceeded its limit.".into());
    }
    let source = std::str::from_utf8(bytes).map_err(|_| "Invalid assessment output encoding.")?;
    let mut fields = source.split('\0');
    if fields.next() != Some("ZYNC_FACTS_V2") || fields.next() != Some(nonce) {
        return Err("Invalid assessment response identity.".into());
    }
    let mut facts = BTreeMap::new();
    for key in keys {
        if fields.next() != Some(*key) {
            return Err("Incomplete or unexpected assessment records.".into());
        }
        let output = fields.next().ok_or("Incomplete assessment record.")?;
        let status: u32 = fields
            .next()
            .and_then(|value| value.parse().ok())
            .filter(|value| *value <= 255)
            .ok_or("Invalid collector status.")?;
        facts.insert(
            (*key).into(),
            Fact {
                output: output.into(),
                status,
            },
        );
    }
    if fields.next() != Some("complete") || fields.next() != Some("") || fields.next().is_some() {
        return Err("Assessment did not complete.".into());
    }
    Ok(Facts(facts))
}
pub const HARDENING_KEYS: &[&str] = &[
    "os",
    "privilege",
    "aslr",
    "ptrace",
    "kptr",
    "dmesg",
    "hardlinks",
    "symlinks",
    "bpf",
    "redirects",
    "send_redirects",
    "source_route",
    "rp_filter",
    "ipv6_redirects",
    "dumps",
    "passwd",
    "shadow",
    "shadow_group",
    "ssh_config",
    "ssh_defaults",
    "accounts",
    "shadow_empty",
    "listeners",
    "nft",
    "iptables",
    "ip6tables",
    "tmp_mount",
    "shm_mount",
    "apt_policy",
    "package_health",
    "reboot",
    "journal",
    "ssh_service",
];
