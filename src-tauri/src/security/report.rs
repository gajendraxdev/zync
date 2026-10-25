//! Bounded, inert report contract for read-only host hardening.
use super::{
    modules::{ModuleDefinition, ModuleId},
    policy::{EvidenceKind, PolicyMetadata, Priority, RoleId},
    profile::Profile,
};
use serde::{Deserialize, Serialize};

pub const MAX_REPORT_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_FINDINGS: usize = 1000;
pub const MAX_REMEDIATION_FIELD_CHARS: usize = 4096;
pub const MAX_SCOPE_SUMMARY_CHARS: usize = 500;
pub const BASELINE: &str = "zync-linux-7 (2026-10-25)";

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
    /// Omitted scope preserves the original host-only behavior; empty/unknown scopes fail closed.
    #[serde(default)]
    pub modules: Option<Vec<ModuleId>>,
    #[serde(default)]
    pub preset_id: RoleId,
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
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    #[serde(default)]
    pub target_key: String,
    #[serde(default)]
    pub evidence_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence_kind: Option<EvidenceKind>,
    #[serde(default)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<Priority>,
    #[serde(default)]
    pub module_id: String,
    pub id: String,
    pub category: String,
    pub needs_elevated_access: bool,
    /// Eligibility for an explicit full rerun is not evidence that elevation is required.
    pub sudo_retry_eligible: bool,
    pub status: String,
    pub title: String,
    pub target: String,
    #[serde(default)]
    pub observed: String,
    #[serde(default)]
    pub expected: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub scope: String,
    /// Authored short scope retains decisive limits; full scope stays available for inspection.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_summary: Option<String>,
    #[serde(default)]
    pub rule_version: String,
    #[serde(default)]
    pub reviewed_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub applicability_reason: Option<String>,
    pub evidence: String,
    pub recommendation: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remediation: Option<RemediationGuide>,
    pub reference: String,
}
/// Optional inert guidance for an evidenced finding; historical reports need not carry it.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemediationGuide {
    pub change: String,
    pub impact: String,
    pub verification: String,
    pub rollback: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub policy: PolicyMetadata,
    pub transport_fingerprint: Option<String>,
    pub kind: Kind,
    pub version: String,
    pub target: String,
    pub os: String,
    pub profile: Profile,
    pub modules: Vec<ModuleDefinition>,
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
            policy:RoleId::General.metadata(),
            transport_fingerprint:None,
            kind,
            version: BASELINE.into(),
            target: "Connected Linux host".into(),
            os,
            profile,
            modules: vec![],
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
