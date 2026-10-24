//! Bounded, inert report contract for read-only host hardening.
use super::profile::Profile;
use serde::{Deserialize, Serialize};

pub const MAX_REPORT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_FINDINGS: usize = 1000;
pub const BASELINE: &str = "zync-linux-5 (2026-10-25)";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Hardening,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Request {
    pub kind: Kind,
    #[serde(default)]
    pub elevation_consent: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HostIdentity {
    pub host: String,
    pub username: String,
    pub port: u16,
}
impl HostIdentity {
    /// Saved renderer edits cannot relabel a still-live transport to another endpoint.
    pub fn verify_expected(&self, expected: &Self) -> Result<(), String> {
        if self != expected {
            return Err("The saved host differs from the live SSH connection. Reconnect before starting an assessment.".into());
        }
        Ok(())
    }
}
#[derive(Serialize)]
pub struct Admission {
    pub id: String,
    pub identity: HostIdentity,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub id: String,
    pub category: String,
    pub needs_elevated_access: bool,
    /// Eligibility for an explicit full rerun is not evidence that elevation is required.
    pub sudo_retry_eligible: bool,
    pub status: String,
    pub title: String,
    pub target: String,
    pub observed: String,
    pub expected: String,
    pub rationale: String,
    pub scope: String,
    pub rule_version: String,
    pub reviewed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applicability_reason: Option<String>,
    pub evidence: String,
    pub recommendation: String,
    pub reference: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub kind: Kind,
    pub version: String,
    pub target: String,
    pub os: String,
    pub profile: Profile,
    pub findings: Vec<Finding>,
    pub total_findings: usize,
    pub truncated: bool,
    pub notes: Vec<String>,
    pub collector_uid: Option<u32>,
    pub elevation_requested: bool,
}
impl Report {
    /// Reports describe a bounded scope, never a certification or an inferred clean host.
    pub fn new(kind: Kind, os: String, profile: Profile) -> Self {
        Self {
            kind,
            version: BASELINE.into(),
            target: "Connected Linux host".into(),
            os,
            profile,
            findings: vec![],
            total_findings: 0,
            truncated: false,
            collector_uid: None,
            elevation_requested: false,
            notes: vec!["These results describe the server at the time of this read-only review. No settings, packages or services were changed.".into()],
        }
    }
    /// Count all observations while bounding renderer/export allocations.
    pub fn push(&mut self, finding: Finding) {
        self.total_findings += 1;
        if self.findings.len() < MAX_FINDINGS {
            self.findings.push(finding);
        } else {
            self.truncated = true;
        }
    }
}
/// Strip terminal/bidi controls and cap displayed fields; source text is never executable.
pub fn text(value: &str, limit: usize) -> String {
    value
        .chars()
        .filter_map(|ch| {
            if matches!(ch, '\n' | '\r' | '\t') {
                return Some(' ');
            }
            (!ch.is_control()
                && !('\u{202a}'..='\u{202e}').contains(&ch)
                && !('\u{2066}'..='\u{2069}').contains(&ch))
            .then_some(ch)
        })
        .take(limit)
        .collect()
}
