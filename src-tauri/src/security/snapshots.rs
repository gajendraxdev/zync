//! Explicit, bounded imports of inert local comparison data; imported records never execute checks.
use super::report::{
    self, Finding, MAX_FINDINGS, MAX_REMEDIATION_FIELD_CHARS, MAX_REPORT_BYTES,
    MAX_SCOPE_SUMMARY_CHARS,
};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::io::AsyncReadExt;

const MAX_ANNOTATIONS: usize = MAX_FINDINGS;
const MAX_ANNOTATION_BYTES: usize = 1024 * 1024;
const MAX_ACCEPTANCE_MS: u64 = 90 * 24 * 60 * 60 * 1000;

pub(crate) mod export;
pub(crate) mod library;

/// A persisted or version-3 exported report carries only normalized evidence and explicit risk notes.
#[derive(Serialize)]
pub struct ReportPackage {
    result: Snapshot,
    annotations: Vec<Annotation>,
}

/// Reuse the import validators for persistence and exports, discarding all unknown input fields.
fn decode_package(bytes: &[u8], now: u64) -> Result<ReportPackage, String> {
    if bytes.len() > MAX_REPORT_BYTES + MAX_ANNOTATION_BYTES {
        return Err("The report and its notes exceed the save limit.".into());
    }
    let PortableReport {
        version,
        snapshot,
        annotations,
    } = serde_json::from_slice(bytes).map_err(|_| "Invalid assessment report.")?;
    if !matches!(version, 2 | 3) {
        return Err("Unsupported assessment report version.".into());
    }
    let annotations = if version == 3 {
        annotations
    } else {
        Vec::new()
    };
    let result = decode_report(
        &serde_json::to_vec(&SavedSnapshot {
            version: 2,
            snapshot,
        })
        .map_err(|_| "Invalid report.")?,
    )?;
    let mut annotations = decode_annotations(
        &serde_json::to_vec(&serde_json::json!({"version":1,"annotations":annotations}))
            .map_err(|_| "Invalid risk notes.")?,
        now,
    )?;
    annotations.retain(|item| {
        result
            .report
            .findings
            .iter()
            .any(|finding| annotation_matches(&result, item, finding))
    });
    Ok(ReportPackage {
        result,
        annotations,
    })
}

/// Only notes for an exact attention finding belong to a report; expired matching notes remain inert history.
fn annotation_matches(snapshot: &Snapshot, item: &Annotation, finding: &Finding) -> bool {
    finding.status == "attention"
        && item.host == snapshot.subject.host
        && item.username == snapshot.subject.username
        && item.port == snapshot.subject.port
        && snapshot.report.transport_fingerprint.as_ref() == Some(&item.transport_fingerprint)
        && snapshot.report.policy.as_ref().is_some_and(|policy| {
            item.policy_id == policy.id && item.policy_revision == policy.revision
        })
        && item.module_id == finding.module_id
        && item.rule_id == finding.id
        && item.rule_version == finding.rule_version
        && item.target_key == finding.target_key
        && item.evidence_key == finding.evidence_key
}

/// Encode the interoperable report format without internal storage IDs, credentials or client configuration.
fn encode_package(package: &ReportPackage) -> Result<Vec<u8>, String> {
    let mut value =
        serde_json::to_value(&package.result).map_err(|_| "Could not encode the report.")?;
    value["version"] = 3.into();
    value["annotations"] =
        serde_json::to_value(&package.annotations).map_err(|_| "Could not encode risk notes.")?;
    // Compact output preserves the same raw-byte budget accepted by import and local storage.
    serde_json::to_vec(&value).map_err(|_| "Could not encode the report.".into())
}

/// Local wall-clock time governs saved timestamps and annotation expiry, never server authorization.
fn current_time() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is unavailable.")?
        .as_millis() as u64)
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotSubject {
    connection_id: String,
    name: String,
    host: String,
    username: String,
    port: u16,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotModule {
    id: String,
    label: String,
    #[serde(default)]
    description: String,
    group: String,
    check_count: usize,
    #[serde(default)]
    recommended: bool,
}

#[derive(Deserialize, Serialize)]
pub struct SnapshotPolicy {
    id: String,
    label: String,
    revision: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotProfile {
    id: String,
    label: String,
    platform_id: String,
    platform_version: String,
    coverage: String,
    coverage_note: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotReport {
    kind: String,
    target: String,
    os: String,
    version: String,
    findings: Vec<Finding>,
    total_findings: usize,
    truncated: bool,
    #[serde(default)]
    notes: Vec<String>,
    #[serde(default)]
    collector_uid: Option<u32>,
    #[serde(default)]
    elevation_requested: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    modules: Option<Vec<SnapshotModule>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    policy: Option<SnapshotPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    profile: Option<SnapshotProfile>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    transport_fingerprint: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    subject: SnapshotSubject,
    report: SnapshotReport,
    started_at: u64,
    completed_at: u64,
}

#[derive(Deserialize, Serialize)]
struct SavedSnapshot {
    version: u32,
    #[serde(flatten)]
    snapshot: Snapshot,
}

#[derive(Deserialize)]
struct PortableReport {
    version: u32,
    #[serde(flatten)]
    snapshot: Snapshot,
    #[serde(default)]
    annotations: Vec<Annotation>,
}

#[derive(Clone, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Annotation {
    id: String,
    host: String,
    username: String,
    port: u16,
    transport_fingerprint: String,
    policy_id: String,
    policy_revision: String,
    module_id: String,
    target_key: String,
    rule_id: String,
    rule_version: String,
    evidence_key: String,
    reason: String,
    created_at: u64,
    expires_at: u64,
}

#[derive(Deserialize)]
struct SavedAnnotations {
    version: u32,
    annotations: Vec<Annotation>,
}

/// Imports normalize plain text and reject oversized fields instead of silently changing comparison identities.
fn bounded(value: &mut String, max: usize, required: bool) -> Result<(), String> {
    if value.chars().count() > max || required && value.trim().is_empty() {
        return Err("The selected file contains missing or oversized assessment fields.".into());
    }
    *value = report::text(value, max);
    if required && value.trim().is_empty() {
        return Err(
            "The selected file contains an empty assessment field after text normalization.".into(),
        );
    }
    Ok(())
}

/// Step fields retain authored line boundaries; all other fields keep flat text normalization.
fn bounded_steps(value: &mut String) -> Result<(), String> {
    if value.chars().count() > MAX_REMEDIATION_FIELD_CHARS || value.trim().is_empty() {
        return Err("The selected file contains missing or oversized assessment fields.".into());
    }
    *value = value
        .replace("\r\n", "\n")
        .replace('\r', "\n")
        .split('\n')
        .map(|line| report::text(line, MAX_REMEDIATION_FIELD_CHARS))
        .collect::<Vec<_>>()
        .join("\n");
    if value.trim().is_empty() {
        return Err(
            "The selected file contains an empty assessment field after text normalization.".into(),
        );
    }
    Ok(())
}

/// Identity-bearing fields are matched exactly; control/bidi characters cannot normalize into another subject.
fn identity(value: &mut String, max: usize) -> Result<(), String> {
    if value.is_empty() || value.chars().count() > max || report::text(value, max) != *value {
        return Err("The selected file contains an invalid comparison identity.".into());
    }
    Ok(())
}

/// Imported identifiers remain inert and cannot masquerade as prototype properties or contain path/command syntax.
fn identifier(value: &mut String) -> Result<(), String> {
    identity(value, 128)?;
    if matches!(value.as_str(), "__proto__" | "prototype" | "constructor")
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    {
        return Err("The selected file contains an invalid result identifier.".into());
    }
    Ok(())
}

/// Comparison hashes must be exact digests, not arbitrary strings supplied by a local file.
fn hash(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..].bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// A recorded SSH identity uses the same SHA-256 public-key fingerprint shape as the authenticated transport.
fn fingerprint(value: &str) -> bool {
    value
        .strip_prefix("SHA256:")
        .and_then(|value| {
            base64::engine::general_purpose::STANDARD_NO_PAD
                .decode(value)
                .ok()
        })
        .is_some_and(|value| value.len() == 32)
}

/// Reject duplicate/ambiguous findings and preserve absent legacy provenance as explicitly non-comparable.
pub(super) fn decode_report(bytes: &[u8]) -> Result<Snapshot, String> {
    if bytes.len() > MAX_REPORT_BYTES {
        return Err("The selected assessment report is too large.".into());
    }
    let SavedSnapshot {
        version,
        mut snapshot,
    } = serde_json::from_slice(bytes)
        .map_err(|_| "Select a valid exported assessment JSON report.")?;
    if version != 2
        || snapshot.report.kind != "hardening"
        || snapshot.subject.port == 0
        || snapshot.started_at > snapshot.completed_at
        || snapshot.completed_at > 8_640_000_000_000_000
        || snapshot.report.findings.len() > MAX_FINDINGS
        || snapshot.report.total_findings < snapshot.report.findings.len()
        || snapshot.report.total_findings > 100_000
    {
        return Err("The selected report has an unsupported format or invalid bounds.".into());
    }
    for (field, limit) in [
        (&mut snapshot.subject.connection_id, 256),
        (&mut snapshot.subject.name, 256),
        (&mut snapshot.report.target, 512),
        (&mut snapshot.report.os, 128),
        (&mut snapshot.report.version, 128),
    ] {
        bounded(field, limit, true)?;
    }
    identity(&mut snapshot.subject.host, 256)?;
    identity(&mut snapshot.subject.username, 128)?;
    if snapshot
        .report
        .transport_fingerprint
        .as_ref()
        .is_some_and(|key| !fingerprint(key))
    {
        return Err("The selected report has an invalid SSH identity.".into());
    }
    if let Some(policy) = snapshot.report.policy.as_mut() {
        identifier(&mut policy.id)?;
        identifier(&mut policy.revision)?;
        bounded(&mut policy.label, 100, true)?;
    }
    if let Some(profile) = snapshot.report.profile.as_mut() {
        for field in [
            &mut profile.id,
            &mut profile.label,
            &mut profile.platform_id,
            &mut profile.platform_version,
        ] {
            bounded(field, 128, false)?;
        }
        bounded(&mut profile.coverage_note, 4096, false)?;
        if !matches!(profile.coverage.as_str(), "targeted" | "generic") {
            return Err("The selected report has an invalid coverage profile.".into());
        }
    }
    if let Some(modules) = snapshot.report.modules.as_mut() {
        if modules.len() > 32 {
            return Err("The selected report has too many check areas.".into());
        }
        let mut ids = BTreeSet::new();
        for module in modules {
            identifier(&mut module.id)?;
            bounded(&mut module.label, 100, true)?;
            bounded(&mut module.description, 500, false)?;
            if !ids.insert(module.id.clone())
                || !matches!(module.group.as_str(), "host" | "applications")
                || module.check_count == 0
                || module.check_count > MAX_FINDINGS
            {
                return Err("The selected report has ambiguous check areas.".into());
            }
        }
    }
    if snapshot.report.notes.len() > 50 {
        return Err("The selected report has too many coverage notes.".into());
    }
    for note in &mut snapshot.report.notes {
        bounded(note, 4096, false)?;
    }
    let mut finding_ids = BTreeSet::new();
    for finding in &mut snapshot.report.findings {
        if !matches!(
            finding.status.as_str(),
            "attention" | "informational" | "passed" | "notAssessed" | "notApplicable"
        ) {
            return Err("The selected report contains an unsupported result state.".into());
        }
        identifier(&mut finding.id)?;
        if !finding.module_id.is_empty() {
            identifier(&mut finding.module_id)?;
        }
        if !finding.rule_version.is_empty() {
            identifier(&mut finding.rule_version)?;
        }
        bounded(&mut finding.reviewed_at, 128, false)?;
        if finding.id.is_empty()
            || !finding_ids.insert((
                finding.module_id.clone(),
                finding.id.clone(),
                finding.target_key.clone(),
            ))
        {
            return Err("The selected report contains ambiguous result identities.".into());
        }
        for field in [
            &mut finding.title,
            &mut finding.target,
            &mut finding.observed,
            &mut finding.expected,
            &mut finding.rationale,
            &mut finding.scope,
            &mut finding.evidence,
            &mut finding.recommendation,
            &mut finding.reference,
            &mut finding.category,
        ] {
            bounded(field, 4096, false)?;
        }
        if let Some(reason) = finding.applicability_reason.as_mut() {
            bounded(reason, 4096, false)?;
        }
        if let Some(summary) = finding.scope_summary.as_mut() {
            bounded(summary, MAX_SCOPE_SUMMARY_CHARS, true)?;
        }
        if let Some(guide) = finding.remediation.as_mut() {
            for field in [&mut guide.change, &mut guide.verification] {
                bounded_steps(field)?;
            }
            for field in [&mut guide.impact, &mut guide.rollback] {
                bounded(field, MAX_REMEDIATION_FIELD_CHARS, true)?;
            }
        }
        // Collection gaps and observations must never acquire a configuration-change guide on import.
        if finding.status != "attention" {
            finding.remediation = None;
        }
        if !finding.target_key.is_empty() && !hash(&finding.target_key)
            || !finding.evidence_key.is_empty() && !hash(&finding.evidence_key)
        {
            return Err("The selected report contains invalid comparison keys.".into());
        }
    }
    Ok(snapshot)
}

/// Accepted-risk data is bounded and expires; it never rewrites a report's status or coverage counts.
pub(super) fn decode_annotations(bytes: &[u8], now: u64) -> Result<Vec<Annotation>, String> {
    if bytes.len() > MAX_ANNOTATION_BYTES {
        return Err("The selected annotation file is too large.".into());
    }
    let SavedAnnotations {
        version,
        mut annotations,
    } = serde_json::from_slice(bytes).map_err(|_| "Select a valid accepted-risk JSON file.")?;
    if version != 1 || annotations.len() > MAX_ANNOTATIONS {
        return Err("The selected annotations have an unsupported version or count.".into());
    }
    let mut ids = BTreeSet::new();
    for item in &mut annotations {
        if uuid::Uuid::parse_str(&item.id).is_err()
            || !ids.insert(item.id.clone())
            || item.port == 0
            || !fingerprint(&item.transport_fingerprint)
            || !hash(&item.target_key)
            || !hash(&item.evidence_key)
            || item.created_at > now.saturating_add(60_000)
            || item.expires_at <= item.created_at
            || item.expires_at - item.created_at > MAX_ACCEPTANCE_MS
        {
            return Err("The selected annotations have invalid identities or expiry dates.".into());
        }
        identity(&mut item.host, 256)?;
        identity(&mut item.username, 128)?;
        for field in [
            &mut item.policy_id,
            &mut item.policy_revision,
            &mut item.module_id,
            &mut item.rule_id,
            &mut item.rule_version,
        ] {
            identifier(field)?;
        }
        item.reason = item.reason.trim().to_string();
        bounded(&mut item.reason, 500, true)?;
    }
    Ok(annotations)
}

/// Read only regular local files with both metadata and streaming caps; no report is persisted on import.
async fn read_bounded(path: &str, limit: usize) -> Result<Vec<u8>, String> {
    let path = Path::new(path);
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|_| "Could not read the selected JSON file.")?;
    if !metadata.is_file() || metadata.len() > limit as u64 {
        return Err("Select a regular JSON file within the import size limit.".into());
    }
    let file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Could not open the selected JSON file.")?;
    if !file
        .metadata()
        .await
        .map_err(|_| "Could not inspect the selected file.")?
        .is_file()
    {
        return Err("Select a regular JSON file.".into());
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| "Could not read the selected JSON file.")?;
    if bytes.len() > limit {
        return Err("The selected JSON file exceeded the import size limit.".into());
    }
    Ok(bytes)
}

/// Only the main renderer may explicitly import an inert user-selected comparison report.
#[tauri::command]
pub async fn security_assessment_import_report(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<Snapshot, String> {
    super::runner::main_window(&window)?;
    Ok(decode_package(
        &read_bounded(&path, MAX_REPORT_BYTES + MAX_ANNOTATION_BYTES).await?,
        current_time()?,
    )?
    .result)
}

/// Explicit report import restores risk notes too; it does not save or execute the imported report.
#[tauri::command]
pub async fn security_assessment_import_package(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<ReportPackage, String> {
    super::runner::main_window(&window)?;
    decode_package(
        &read_bounded(&path, MAX_REPORT_BYTES + MAX_ANNOTATION_BYTES).await?,
        current_time()?,
    )
}

/// Imported annotations require an explicit action and the same main-window boundary as reports.
#[tauri::command]
pub async fn security_assessment_import_annotations(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<Vec<Annotation>, String> {
    super::runner::main_window(&window)?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| "The system clock is unavailable.")?
        .as_millis() as u64;
    decode_annotations(&read_bounded(&path, MAX_ANNOTATION_BYTES).await?, now)
}

#[cfg(test)]
mod tests;
