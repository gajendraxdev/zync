//! Independent local acceptances; historical report packages are immutable evidence snapshots.
use super::{storage_error, ReportLibrary, Revision, REPORTS};
use crate::security::snapshots::{self, Annotation, ReportPackage, SnapshotSubject};
use redb::{Database, ReadableTable, ReadableTableMetadata, TableDefinition, WriteTransaction};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

const RISKS: TableDefinition<&str, &[u8]> = TableDefinition::new("security_accepted_risks_v1");
const META: TableDefinition<&str, u64> = TableDefinition::new("security_risk_metadata_v1");
const GENERATION: &str = "acceptance-generation";
const MAX_RISKS: u64 = 5000;
const MAX_RISK_BYTES: usize = 12 * 1024;
const MAX_TOTAL_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedRisk {
    id: String,
    revision: u64,
    title: String,
    target: String,
    annotation: Annotation,
}

/// One row represents one exact host/policy/rule/target/evidence binding, regardless of renewal UUID.
fn risk_key(item: &Annotation) -> String {
    let binding = serde_json::to_vec(&(
        &item.host,
        &item.username,
        item.port,
        &item.transport_fingerprint,
        &item.policy_id,
        &item.policy_revision,
        &item.module_id,
        &item.target_key,
        &item.rule_id,
        &item.rule_version,
        &item.evidence_key,
    ))
    .expect("String tuples are serializable");
    format!(
        "sha256:{}",
        Sha256::digest(binding)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

/// New tables reuse the report database/cache and never introduce another background store.
pub(super) fn initialize(tx: &WriteTransaction) -> Result<(), String> {
    tx.open_table(RISKS).map_err(storage_error)?;
    tx.open_table(META).map_err(storage_error)?;
    Ok(())
}

/// Validate stored rows through the existing annotation boundary; corrupt data is never silently discarded.
fn decode(bytes: &[u8], now: u64) -> Result<SavedRisk, String> {
    if bytes.len() > MAX_RISK_BYTES {
        return Err("Invalid saved accepted risk.".into());
    }
    let mut record: SavedRisk = serde_json::from_slice(bytes).map_err(storage_error)?;
    let validated = snapshots::decode_annotations(
        &serde_json::to_vec(&serde_json::json!({"version":1,"annotations":[record.annotation]}))
            .map_err(storage_error)?,
        now,
    )?;
    record.annotation = validated
        .into_iter()
        .next()
        .ok_or("Invalid accepted risk.")?;
    if record.revision == 0
        || record.id != risk_key(&record.annotation)
        || record.title.chars().count() > 256
        || record.target.chars().count() > 512
        || snapshots::report::text(&record.title, 256) != record.title
        || snapshots::report::text(&record.target, 512) != record.target
    {
        return Err("Invalid saved accepted risk identity.".into());
    }
    Ok(record)
}

/// Copy embedded notes once and seed a durable generation above every existing row revision.
/// The generation survives removal, including removal of the final acceptance.
pub(super) fn migrate(database: &Database) -> Result<(), String> {
    {
        let read = database.begin_read().map_err(storage_error)?;
        let meta = read.open_table(META).map_err(storage_error)?;
        if meta
            .get("embedded-notes-migrated")
            .map_err(storage_error)?
            .is_some()
            && meta.get(GENERATION).map_err(storage_error)?.is_some()
        {
            return Ok(());
        }
    }
    let tx = database.begin_write().map_err(storage_error)?;
    let mut meta = tx.open_table(META).map_err(storage_error)?;
    let embedded_migrated = meta
        .get("embedded-notes-migrated")
        .map_err(storage_error)?
        .is_some();
    let saved_generation = meta
        .get(GENERATION)
        .map_err(storage_error)?
        .map(|item| item.value());
    if embedded_migrated && saved_generation.is_some() {
        return Ok(());
    }
    let reports = tx.open_table(REPORTS).map_err(storage_error)?;
    let mut risks = tx.open_table(RISKS).map_err(storage_error)?;
    if reports.len().map_err(storage_error)? > super::MAX_RECORDS
        || risks.len().map_err(storage_error)? > MAX_RISKS
    {
        return Err("Invalid saved history size.".into());
    }
    let now = snapshots::current_time()?;
    let mut bytes = 0u64;
    let mut generation = saved_generation.unwrap_or(0);
    for row in risks.iter().map_err(storage_error)? {
        let (_, value) = row.map_err(storage_error)?;
        generation = generation.max(decode(value.value(), now)?.revision);
        bytes = bytes
            .checked_add(value.value().len() as u64)
            .ok_or("Invalid accepted-risk storage size.")?;
    }
    if !embedded_migrated {
        for row in reports.iter().map_err(storage_error)? {
            let (_, body) = row.map_err(storage_error)?;
            let package = snapshots::decode_package(body.value(), now)?;
            for mut record in records(&package) {
                let previous = risks
                    .get(record.id.as_str())
                    .map_err(storage_error)?
                    .map(|value| decode(value.value(), now))
                    .transpose()?;
                if previous.as_ref().is_some_and(|old| {
                    (
                        old.annotation.created_at,
                        old.annotation.expires_at,
                        &old.annotation.id,
                    ) >= (
                        record.annotation.created_at,
                        record.annotation.expires_at,
                        &record.annotation.id,
                    )
                }) {
                    continue;
                }
                record.revision = advance_generation(&mut generation)?;
                let encoded = encode(&record)?;
                let old_bytes = risks
                    .get(record.id.as_str())
                    .map_err(storage_error)?
                    .map_or(0, |value| value.value().len() as u64);
                bytes = bytes
                    .saturating_sub(old_bytes)
                    .saturating_add(encoded.len() as u64);
                if risks.len().map_err(storage_error)? >= MAX_RISKS && previous.is_none()
                    || bytes > MAX_TOTAL_BYTES
                {
                    return Err("Accepted-risk storage is full.".into());
                }
                risks
                    .insert(record.id.as_str(), encoded.as_slice())
                    .map_err(storage_error)?;
            }
        }
    }
    drop(risks);
    drop(reports);
    meta.insert("embedded-notes-migrated", 1)
        .map_err(storage_error)?;
    meta.insert(GENERATION, generation).map_err(storage_error)?;
    drop(meta);
    tx.commit().map_err(storage_error)
}

/// A transaction allocates monotonically increasing revisions instead of reusing deleted-row versions.
fn advance_generation(generation: &mut u64) -> Result<u64, String> {
    *generation = generation
        .checked_add(1)
        .ok_or("Accepted-risk revision limit reached.")?;
    Ok(*generation)
}

/// Build display metadata only from a normalized report whose exact attention finding matches the note.
fn records(package: &ReportPackage) -> Vec<SavedRisk> {
    package
        .annotations
        .iter()
        .filter_map(|annotation| {
            let finding = package.result.report.findings.iter().find(|finding| {
                snapshots::annotation_matches(&package.result, annotation, finding)
            })?;
            Some(SavedRisk {
                id: risk_key(annotation),
                // A new/renewed row receives its durable generation in the write transaction.
                revision: 1,
                title: snapshots::report::text(&finding.title, 256),
                target: snapshots::report::text(&finding.target, 512),
                annotation: annotation.clone(),
            })
        })
        .collect()
}

/// Bound every serialized row independently as well as the aggregate database payload.
fn encode(record: &SavedRisk) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(record).map_err(storage_error)?;
    if bytes.len() > MAX_RISK_BYTES {
        return Err("This accepted risk exceeds the storage limit.".into());
    }
    Ok(bytes)
}

/// The endpoint/account fence survives connection-ID changes; host-key/evidence matching still governs use.
fn same_subject(record: &SavedRisk, subject: &SnapshotSubject) -> bool {
    record.annotation.host == subject.host
        && record.annotation.username == subject.username
        && record.annotation.port == subject.port
}

impl ReportLibrary {
    /// Read bounded independent acceptances without retaining report bodies after the one-time migration.
    fn list_risks(&self, subject: &SnapshotSubject) -> Result<Vec<SavedRisk>, String> {
        let database = self.database()?;
        migrate(&database)?;
        let tx = database.begin_read().map_err(storage_error)?;
        let table = tx.open_table(RISKS).map_err(storage_error)?;
        if table.len().map_err(storage_error)? > MAX_RISKS {
            return Err("Accepted-risk storage exceeds its limit.".into());
        }
        let now = snapshots::current_time()?;
        let mut rows = Vec::new();
        for row in table.iter().map_err(storage_error)? {
            let (key, bytes) = row.map_err(storage_error)?;
            let record = decode(bytes.value(), now)?;
            if key.value() != record.id {
                return Err("Invalid accepted-risk index.".into());
            }
            if same_subject(&record, subject) {
                rows.push(record);
            }
        }
        rows.sort_by(|a, b| {
            b.annotation
                .created_at
                .cmp(&a.annotation.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(rows)
    }

    /// An explicit acceptance/import saves only validated matching notes, with optimistic renewal revisions.
    fn save_risks(
        &self,
        payload: &str,
        revisions: Vec<Revision>,
    ) -> Result<Vec<SavedRisk>, String> {
        let now = snapshots::current_time()?;
        let package = snapshots::decode_package(payload.as_bytes(), now)?;
        let mut incoming = records(&package);
        if incoming.is_empty() {
            return Err("Choose accepted risks matching this report's attention findings.".into());
        }
        if revisions.len() > snapshots::MAX_ANNOTATIONS {
            return Err("Too many accepted-risk revisions.".into());
        }
        let expected: BTreeMap<_, _> = revisions
            .iter()
            .map(|item| (item.id.as_str(), item.revision))
            .collect();
        if expected.len() != revisions.len() {
            return Err("Duplicate accepted-risk revisions.".into());
        }
        let mut ids = BTreeSet::new();
        if incoming.iter().any(|item| !ids.insert(item.id.clone()))
            || expected.keys().any(|id| !ids.contains(*id))
        {
            return Err("Choose one acceptance per matching finding.".into());
        }
        let database = self.database()?;
        migrate(&database)?;
        let tx = database.begin_write().map_err(storage_error)?;
        let mut table = tx.open_table(RISKS).map_err(storage_error)?;
        let mut meta = tx.open_table(META).map_err(storage_error)?;
        let mut generation = meta
            .get(GENERATION)
            .map_err(storage_error)?
            .map(|item| item.value())
            .ok_or("Accepted-risk revisions are not initialized.")?;
        let mut bytes = 0u64;
        if table.len().map_err(storage_error)? > MAX_RISKS {
            return Err("Accepted-risk storage exceeds its limit.".into());
        }
        for row in table.iter().map_err(storage_error)? {
            let (_, value) = row.map_err(storage_error)?;
            bytes = bytes
                .checked_add(value.value().len() as u64)
                .ok_or("Invalid accepted-risk storage size.")?;
        }
        for record in &mut incoming {
            let old = table
                .get(record.id.as_str())
                .map_err(storage_error)?
                .map(|value| {
                    Ok::<_, String>((decode(value.value(), now)?, value.value().len() as u64))
                })
                .transpose()?;
            if old.as_ref().is_some_and(|(old, _)| old.id != record.id) {
                return Err("Invalid accepted-risk index.".into());
            }
            if old
                .as_ref()
                .is_some_and(|(old, _)| old.annotation.created_at > record.annotation.created_at)
            {
                return Err("A newer acceptance is already saved. Create a new acceptance instead of restoring an older note.".into());
            }
            match (&old, expected.get(record.id.as_str())) {
                (Some((old, _)), Some(revision)) if old.revision == *revision => {}
                (Some((old, _)), None) if old.annotation == record.annotation => {
                    *record = old.clone();
                    continue;
                }
                (None, None) => {}
                _ => {
                    return Err(
                        "This accepted risk changed. Refresh the list before saving it.".into(),
                    )
                }
            }
            record.revision = advance_generation(&mut generation)?;
            let encoded = encode(record)?;
            bytes = bytes
                .saturating_sub(old.as_ref().map_or(0, |(_, size)| *size))
                .saturating_add(encoded.len() as u64);
            if old.is_none() && table.len().map_err(storage_error)? >= MAX_RISKS
                || bytes > MAX_TOTAL_BYTES
            {
                return Err(
                    "Accepted-risk storage is full. Remove an unused acceptance first.".into(),
                );
            }
            table
                .insert(record.id.as_str(), encoded.as_slice())
                .map_err(storage_error)?;
        }
        meta.insert(GENERATION, generation).map_err(storage_error)?;
        drop(meta);
        drop(table);
        tx.commit().map_err(storage_error)?;
        Ok(incoming)
    }

    /// Removal revokes future use without rewriting notes in historical saved reports.
    fn remove_risk(&self, revision: Revision, subject: &SnapshotSubject) -> Result<(), String> {
        let database = self.database()?;
        migrate(&database)?;
        let tx = database.begin_write().map_err(storage_error)?;
        let mut table = tx.open_table(RISKS).map_err(storage_error)?;
        let record = table
            .get(revision.id.as_str())
            .map_err(storage_error)?
            .map(|bytes| decode(bytes.value(), snapshots::current_time()?))
            .transpose()?
            .ok_or("This accepted risk was already removed.")?;
        if record.id != revision.id
            || record.revision != revision.revision
            || !same_subject(&record, subject)
        {
            return Err(
                "This accepted risk changed or belongs to another host. Refresh the list.".into(),
            );
        }
        table.remove(revision.id.as_str()).map_err(storage_error)?;
        drop(table);
        tx.commit().map_err(storage_error)
    }
}

/// A report and its explicitly selected, still-identical acceptances are deleted in one transaction.
pub(super) fn remove_report_risks(
    tx: &WriteTransaction,
    package: &ReportPackage,
    revisions: &[Revision],
) -> Result<(), String> {
    if revisions.len() > snapshots::MAX_ANNOTATIONS {
        return Err("Too many accepted-risk revisions.".into());
    }
    let mut table = tx.open_table(RISKS).map_err(storage_error)?;
    let mut seen = BTreeSet::new();
    let now = snapshots::current_time()?;
    for revision in revisions {
        if !seen.insert(&revision.id) {
            return Err("Duplicate accepted-risk revisions.".into());
        }
        let record = table
            .get(revision.id.as_str())
            .map_err(storage_error)?
            .map(|bytes| decode(bytes.value(), now))
            .transpose()?
            .ok_or("An accepted risk changed. Refresh before deleting.")?;
        if record.id != revision.id
            || record.revision != revision.revision
            || !same_subject(&record, &package.result.subject)
            || !package
                .annotations
                .iter()
                .any(|annotation| record.annotation == *annotation)
        {
            return Err("An accepted risk changed or does not belong to this report. Refresh before deleting.".into());
        }
        table.remove(revision.id.as_str()).map_err(storage_error)?;
    }
    Ok(())
}

/// Main-window-only local metadata query; no account, Vault or SSH is involved.
#[tauri::command]
pub async fn security_assessment_accepted_risks(
    window: tauri::WebviewWindow,
    library: tauri::State<'_, Arc<ReportLibrary>>,
    subject: SnapshotSubject,
) -> Result<Vec<SavedRisk>, String> {
    crate::security::runner::main_window(&window)?;
    let store = library.inner().clone();
    tokio::task::spawn_blocking(move || store.list_risks(&subject))
        .await
        .map_err(storage_error)?
}

/// Save an explicit acceptance using the same typed evidence validator as report saving.
#[tauri::command]
pub async fn security_assessment_save_accepted_risks(
    window: tauri::WebviewWindow,
    library: tauri::State<'_, Arc<ReportLibrary>>,
    payload: String,
    revisions: Vec<Revision>,
) -> Result<Vec<SavedRisk>, String> {
    crate::security::runner::main_window(&window)?;
    let store = library.inner().clone();
    tokio::task::spawn_blocking(move || store.save_risks(&payload, revisions))
        .await
        .map_err(storage_error)?
}

/// Revoke only the selected host-scoped acceptance revision.
#[tauri::command]
pub async fn security_assessment_remove_accepted_risk(
    window: tauri::WebviewWindow,
    library: tauri::State<'_, Arc<ReportLibrary>>,
    revision: Revision,
    subject: SnapshotSubject,
) -> Result<(), String> {
    crate::security::runner::main_window(&window)?;
    let store = library.inner().clone();
    tokio::task::spawn_blocking(move || store.remove_risk(revision, &subject))
        .await
        .map_err(storage_error)?
}

#[cfg(test)]
mod tests;
