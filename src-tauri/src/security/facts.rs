//! Strict decoding of bounded, nonce-bound read-only collector output.
use super::report::MAX_REPORT_BYTES;
use std::collections::BTreeMap;
pub const MAX_FACT_BYTES: usize = 512 * 1024;
pub struct Fact {
    pub output: String,
    pub status: u32,
}
pub struct Facts(pub BTreeMap<String, Fact>);

/// Named-file checks share exact numeric metadata parsing without duplicating permission policy.
pub(super) fn file_metadata(source: &str, kind: u32) -> Option<(u32, u32, u32)> {
    let mut fields = source.split_whitespace();
    let raw = fields.next()?;
    if raw.is_empty() || raw.len() > 4 || !raw.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    let mode = u32::from_str_radix(raw, 16).ok()?;
    let number = |value: &str| {
        (!value.is_empty() && value.len() <= 10 && value.bytes().all(|byte| byte.is_ascii_digit()))
            .then(|| value.parse::<u32>().ok())
            .flatten()
    };
    let uid = number(fields.next()?)?;
    let gid = number(fields.next()?)?;
    (fields.next().is_none() && mode & 0o170000 == kind).then_some((mode, uid, gid))
}
/// Share the fixed protected-read allowlist across access evidence, sudo prompts and retry eligibility.
pub(super) fn is_protected_read(key: &str) -> bool {
    if key == "docker_workload_list" || key.strip_prefix("docker_workload_")
        .is_some_and(|slot| slot.len()==2 && slot.bytes().all(|byte|byte.is_ascii_digit()) && slot.parse::<u8>().is_ok_and(|slot|slot<20)) {return true;}
    matches!(
        key,
        "hardlinks"
            | "symlinks"
            | "ssh_defaults"
            | "shadow_empty"
            | "nft"
            | "iptables"
            | "ip6tables"
            | "ext_apparmor"
            | "ext_audit"
            | "ext_lsm"
            | "docker_info"
            | "nginx_config"
            | "redis_config"
            | "nginx_config_meta"
            | "redis_config_meta"
            | "ssh_preview_base"
            | "ssh_preview_policy"
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
            && self.0.get(key).is_some_and(|fact| {
                matches!(fact.status, 1..=123) && !matches!(fact.status, 65 | 66)
            })
            && self
                .get("privilege")
                .and_then(|value| value.strip_suffix(" user"))
                .and_then(|uid| uid.parse::<u32>().ok())
                .is_some_and(|uid| uid != 0)
    }
    /// Explain known collection failures without forwarding potentially sensitive command stderr.
    pub fn diagnostic(&self, key: &str) -> String {
        match self.0.get(key) {
            None => "The assessment returned no information for this check.".into(),
            Some(fact) => match fact.status {
                0 if fact.output.len() > MAX_FACT_BYTES => "The response exceeded this check's 512 KiB limit. The check was left unevaluated; a large response does not show whether the setting is safe.".into(),
                0 => "The command finished, but its response was missing, malformed or not understood by this check.".into(),
                77 => if self.get("privilege").is_some_and(|value| value.ends_with(" sudo")) { "The server denied access to the required information even though sudo was allowed. Ask the administrator to review access rules; allowing sudo does not guarantee access.".into() } else { "The server denied access to the required information. Review the access restriction with the administrator; a separately approved sudo run may help where available.".into() },
                126 => "The required system command could not be executed (exit 126).".into(),
                66 => "The required file or local endpoint was not available at the checked location. This does not establish that the application is absent or access was denied.".into(),
                127 => "The required tool was not found in the standard system paths (exit 127). It may be missing or installed elsewhere.".into(),
                124 | 137 => "This check took too long and reached its command deadline.".into(),
                status => format!("The command failed (exit {status}); the cause is not confirmed. Its error output is withheld to avoid exposing sensitive information.{}", if self.get("privilege").is_some_and(|value| value.ends_with(" sudo")) { " Sudo was allowed, but authentication or the command may have failed. This is not a failed security check." } else { " This does not establish a permission problem or a security weakness." }),
            },
        }
    }
    /// Unavailable checks need collection follow-up, never a configuration change inferred from absent evidence.
    pub fn collection_next_step(&self, key: &str) -> &'static str {
        if self.needs_elevated_access(key) {
            return "If authorized, use Retry with sudo to repeat the full assessment and try to read the protected information. Do not change security settings based on an unavailable result.";
        }
        if self.can_retry_with_sudo(key) {
            return "Review the failure in Technical details with the administrator. If authorized, Try with sudo repeats the full assessment and may help read this information. Permission denial is not confirmed, and success is not guaranteed. Do not change security settings based on an unavailable result.";
        }
        match self.0.get(key).map(|fact| fact.status) {
            Some(77) => "Ask the administrator to review the access restriction, then run the assessment again. Do not weaken access controls; allowing sudo does not guarantee access.",
            Some(126) => "Ask the administrator why the required command could not run, then repeat the assessment. This result alone does not justify changing security settings.",
            Some(66) => "Check the module's named files, service units and local endpoints with the administrator. Other installation layouts are not discovered automatically.",
            Some(127) => "Check whether the required tool is available in the standard system paths, then run the assessment again. A missing tool does not establish a security weakness.",
            Some(124 | 137) => "Ask the administrator why the check took too long before trying again. Do not change security settings based on an unavailable result.",
            Some(0) => "Ask the administrator to review the missing, malformed or unrecognized response, then run the assessment again. This result alone does not justify changing security settings.",
            None => "Run the assessment again to obtain this check's information. If it is still unavailable, ask the administrator whether the required command is supported.",
            _ => "Review the failure in Technical details with the administrator, then run the assessment again. Do not change security settings based on an unavailable result.",
        }
    }
    /// Reject failed or oversized evidence before trimming; every rule shares the interpretation budget.
    pub fn get(&self, key: &str) -> Option<&str> {
        self.0
            .get(key)
            .filter(|fact| fact.status == 0 && fact.output.len() <= MAX_FACT_BYTES)
            .map(|fact| fact.output.trim())
    }
    /// Keep the compact observation useful without exporting stderr or inventing collection causes.
    pub fn short_diagnostic(&self, key: &str) -> &'static str {
        match self.0.get(key) {
            None => "No information was returned for this check.",
            Some(fact) => match fact.status {
                0 if fact.output.len() > MAX_FACT_BYTES => {
                    "The response was too large for this check to evaluate."
                }
                0 => "The check did not return usable information (missing or malformed response).",
                77 => "The server denied access to the required information.",
                126 => "The required command could not run.",
                66 => "The required input was unavailable at the checked location.",
                127 => "The required tool was not found in the standard system paths.",
                124 | 137 => "This check took too long.",
                _ => "The command failed; the cause is not confirmed.",
            },
        }
    }
    /// Read one unambiguous assignment as data, requiring matched quotes and no shell evaluation.
    fn os_field(&self, key: &str) -> Option<&str> {
        let source = self.get("os")?;
        let mut values = source.lines().filter_map(|line| line.strip_prefix(key));
        let raw = values.next()?.trim();
        if values.next().is_some() {
            return None;
        }
        match raw.as_bytes().first()? {
            b'"' => raw.strip_prefix('"')?.strip_suffix('"'),
            b'\'' => raw.strip_prefix('\'')?.strip_suffix('\''),
            _ => Some(raw),
        }
    }
    /// Read os-release identifiers without trusting remote text as executable shell code.
    pub fn os(&self) -> Result<(String, String), String> {
        self.get("os")
            .ok_or("Could not read the server's operating-system identity.")?;
        let identifier = |value: &&str| {
            !value.is_empty()
                && value.len() <= 32
                && value.bytes().all(|ch| {
                    ch.is_ascii_lowercase() || ch.is_ascii_digit() || b"._-".contains(&ch)
                })
        };
        let id = self
            .os_field("ID=")
            .filter(identifier)
            .ok_or("The server returned an invalid operating-system identity.")?;
        let version = self
            .os_field("VERSION_ID=")
            .filter(|value| {
                !value.is_empty()
                    && value.len() <= 32
                    && value
                        .bytes()
                        .all(|ch| ch.is_ascii_alphanumeric() || b"._-".contains(&ch))
            })
            .unwrap_or_default();
        Ok((id.into(), version.into()))
    }
    /// Retain only bounded identifier hints; hints alone never select a target release or package scope.
    pub fn os_like(&self) -> Vec<String> {
        let Some(value) = self.os_field("ID_LIKE=").filter(|value| value.len() <= 512) else {
            return vec![];
        };
        let parts: Vec<_> = value.split_whitespace().take(17).collect();
        if parts.len() > 16
            || parts.iter().any(|part| {
                part.is_empty()
                    || part.len() > 32
                    || !part.bytes().all(|ch| {
                        ch.is_ascii_lowercase() || ch.is_ascii_digit() || b"._-".contains(&ch)
                    })
            })
        {
            return vec![];
        }
        parts.into_iter().map(str::to_string).collect()
    }
}
/// Reject truncated, duplicate, unsolicited or over-budget records before evaluating checks.
pub fn decode(bytes: &[u8], nonce: &str, keys: &[&str]) -> Result<Facts, String> {
    if bytes.len() > MAX_REPORT_BYTES {
        return Err("Assessment output exceeded its limit.".into());
    }
    let source = std::str::from_utf8(bytes)
        .map_err(|_| "The server returned assessment text in an unsupported format.")?;
    let mut fields = source.split('\0');
    if fields.next() != Some("ZYNC_FACTS_V2") || fields.next() != Some(nonce) {
        return Err("The assessment response could not be verified for this run.".into());
    }
    let mut facts = BTreeMap::new();
    for key in keys {
        if fields.next() != Some(*key) {
            return Err(
                "The assessment response was incomplete or did not match the requested checks."
                    .into(),
            );
        }
        let output = fields
            .next()
            .ok_or("The assessment response was incomplete.")?;
        let status: u32 = fields
            .next()
            .and_then(|value| value.parse().ok())
            .filter(|value| *value <= 255)
            .ok_or("The assessment returned an invalid command exit status.")?;
        facts.insert(
            (*key).into(),
            Fact {
                output: output.into(),
                status,
            },
        );
    }
    if fields.next() != Some("complete") || fields.next() != Some("") || fields.next().is_some() {
        return Err("The assessment did not finish successfully.".into());
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
