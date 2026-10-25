//! Human-readable local exports share one normalized report schema and never emit executable cells.
use super::{current_time, decode_package, encode_package, Annotation, Finding, ReportPackage};
use rust_xlsxwriter::{Color, Format, Workbook, Worksheet, XlsxError};
use serde::Deserialize;

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Json,
    Csv,
    Xlsx,
}

const HEADERS: &[&str] = &[
    "Host",
    "SSH account",
    "Port",
    "Assessed at (UTC)",
    "Baseline",
    "Preset",
    "Area",
    "Check ID",
    "Check",
    "Result",
    "Review priority",
    "Observed",
    "Expected",
    "Evidence source",
    "Target",
    "Evidence",
    "Recommendation / next step",
    "How to address it",
    "Reference",
    "Rule version",
    "Accepted risk",
    "Acceptance reason",
    "Accepted until (UTC)",
];

/// Report-level baseline/preset metadata belongs once in Summary; CSV retains it for standalone rows.
fn findings_column(header: &str) -> bool {
    !matches!(header, "Baseline" | "Preset")
}

/// Dates are unambiguous UTC text across spreadsheet locales and retain the original assessment time.
fn timestamp(value: u64) -> String {
    i64::try_from(value)
        .ok()
        .and_then(chrono::DateTime::from_timestamp_millis)
        .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
        .unwrap_or_default()
}

/// Risk annotations never alter the native finding result and apply only to the identical evidenced condition.
fn annotation<'a>(
    package: &'a ReportPackage,
    finding: &Finding,
    now: u64,
) -> Option<&'a Annotation> {
    package
        .annotations
        .iter()
        .filter(|item| super::annotation_matches(&package.result, item, finding))
        // Equal timestamps choose the last recorded note, matching the renderer's binding index.
        .max_by_key(|item| item.created_at)
        .filter(|item| item.created_at <= now && item.expires_at > now)
}

/// A spreadsheet row carries the original status plus separately identified acceptance metadata.
fn row(package: &ReportPackage, finding: &Finding, now: u64) -> Vec<String> {
    let snapshot = &package.result;
    let accepted = annotation(package, finding, now);
    let status = match finding.status.as_str() {
        "attention" => "Needs attention",
        "passed" => "Passed",
        "informational" => "Informational",
        "notApplicable" => "Not applicable",
        _ if finding.needs_elevated_access => "Needs elevated access",
        _ => "Evidence unavailable",
    };
    let area = snapshot
        .report
        .modules
        .as_ref()
        .and_then(|modules| modules.iter().find(|module| module.id == finding.module_id))
        .map_or(finding.module_id.as_str(), |module| module.label.as_str());
    let priority = match finding.priority {
        Some(super::super::policy::Priority::High) => "High",
        Some(super::super::policy::Priority::Medium) => "Medium",
        Some(super::super::policy::Priority::Review) => "Review",
        None => "",
    };
    let source = match finding.evidence_kind {
        Some(super::super::policy::EvidenceKind::Runtime) => "Runtime observation",
        Some(super::super::policy::EvidenceKind::EffectiveConfiguration) => "Calculated policy",
        Some(super::super::policy::EvidenceKind::NamedConfiguration) => "Named configuration",
        Some(super::super::policy::EvidenceKind::Metadata) => "Metadata",
        Some(super::super::policy::EvidenceKind::ServiceConfiguration) => "Service configuration",
        Some(super::super::policy::EvidenceKind::WorkloadConfiguration) => {
            "Container configuration"
        }
        None => "",
    };
    vec![
        snapshot.subject.host.clone(),
        snapshot.subject.username.clone(),
        snapshot.subject.port.to_string(),
        timestamp(snapshot.completed_at),
        snapshot.report.version.clone(),
        snapshot
            .report
            .policy
            .as_ref()
            .map_or_else(String::new, |value| value.label.clone()),
        area.into(),
        finding.id.clone(),
        finding.title.clone(),
        status.into(),
        priority.into(),
        finding.observed.clone(),
        finding.expected.clone(),
        source.into(),
        finding.target.clone(),
        finding.evidence.clone(),
        finding.recommendation.clone(),
        finding
            .remediation
            .as_ref()
            .map_or_else(String::new, |guide| {
                format!(
                    "Change: {}\nImpact: {}\nVerify: {}\nUndo: {}",
                    guide.change, guide.impact, guide.verification, guide.rollback
                )
            }),
        finding.reference.clone(),
        finding.rule_version.clone(),
        if accepted.is_some() { "Yes" } else { "No" }.into(),
        accepted.map_or_else(String::new, |value| value.reason.clone()),
        accepted.map_or_else(String::new, |value| timestamp(value.expires_at)),
    ]
}

/// Quote every RFC4180 field. Formula-like prefixes become spreadsheet text, including after whitespace.
fn csv_cell(value: &str) -> String {
    let dangerous = value
        .trim_start()
        .starts_with(['=', '+', '-', '@', '＝', '＋', '－', '＠']);
    format!(
        "\"{}{}\"",
        if dangerous { "\t" } else { "" },
        value.replace('"', "\"\"")
    )
}

/// CSV includes all retained findings, independent of the current UI filter or page.
fn csv(package: &ReportPackage, now: u64) -> Vec<u8> {
    let mut output = String::from("\u{feff}");
    output.push_str(
        &HEADERS
            .iter()
            .map(|value| csv_cell(value))
            .collect::<Vec<_>>()
            .join(","),
    );
    output.push_str("\r\n");
    for finding in &package.result.report.findings {
        output.push_str(
            &row(package, finding, now)
                .iter()
                .map(|value| csv_cell(value))
                .collect::<Vec<_>>()
                .join(","),
        );
        output.push_str("\r\n");
    }
    output.into_bytes()
}

/// Explicit string writes prevent formula, macro and hyperlink interpretation of host-controlled evidence.
fn strings(
    sheet: &mut Worksheet,
    index: u32,
    values: &[String],
    format: &Format,
) -> Result<(), XlsxError> {
    for (column, value) in values.iter().enumerate() {
        sheet.write_string_with_format(index, column as u16, value, format)?;
    }
    Ok(())
}

/// A styled two-sheet workbook presents context first, with frozen/filterable complete findings.
fn xlsx(package: &ReportPackage, now: u64) -> Result<Vec<u8>, String> {
    let mut workbook = Workbook::new();
    let header = Format::new()
        .set_bold()
        .set_font_color(Color::White)
        .set_background_color(Color::RGB(0x25354A))
        .set_text_wrap();
    let body = Format::new()
        .set_text_wrap()
        .set_align(rust_xlsxwriter::FormatAlign::Top);
    let build = |workbook: &mut Workbook| -> Result<(), XlsxError> {
        let summary = workbook.add_worksheet();
        summary.set_name("Summary")?;
        summary.set_column_width(0, 25)?;
        summary.set_column_width(1, 90)?;
        strings(
            summary,
            0,
            &[
                "Zync hardening report".into(),
                "Saved observations; no settings were changed".into(),
            ],
            &header,
        )?;
        let report = &package.result.report;
        let fields=vec![
            ("Host",format!("{}@{}:{}",package.result.subject.username,package.result.subject.host,package.result.subject.port)),
            ("Assessed at (UTC)",timestamp(package.result.completed_at)),("Exported at (UTC)",timestamp(now)),("Operating system",report.os.clone()),("Baseline",report.version.clone()),
            ("Preset",report.policy.as_ref().map_or_else(String::new,|value|value.label.clone())),("Verified SSH key",report.transport_fingerprint.clone().unwrap_or_default()),
            ("Retained checks",report.findings.len().to_string()),("Needs attention",report.findings.iter().filter(|value|value.status=="attention").count().to_string()),
            ("Report limited",if report.truncated{"Yes"}else{"No"}.into()),
            ("Coverage","Only selected settings were checked. This report is not a full security audit or certification.".into()),
        ];
        for (index, (label, value)) in fields.into_iter().enumerate() {
            strings(summary, index as u32 + 1, &[label.into(), value], &body)?;
        }
        let note_start = 14;
        for (index, note) in report.notes.iter().enumerate() {
            strings(
                summary,
                note_start + index as u32,
                &["Coverage note".into(), note.clone()],
                &body,
            )?;
        }
        summary.set_freeze_panes(1, 0)?;
        let sheet = workbook.add_worksheet();
        sheet.set_name("Findings")?;
        let headers: Vec<_> = HEADERS
            .iter()
            .copied()
            .filter(|header| findings_column(header))
            .collect();
        sheet.set_column_range_width(0, headers.len() as u16 - 1, 22)?;
        for (column, header) in headers.iter().enumerate() {
            if matches!(
                *header,
                "Check"
                    | "Observed"
                    | "Expected"
                    | "Target"
                    | "Evidence"
                    | "Recommendation / next step"
                    | "How to address it"
                    | "Acceptance reason"
            ) {
                sheet.set_column_width(column as u16, 48)?;
            }
        }
        strings(
            sheet,
            0,
            &headers
                .iter()
                .map(|value| (*value).into())
                .collect::<Vec<_>>(),
            &header,
        )?;
        sheet.set_row_height(0, 32)?;
        for (index, finding) in report.findings.iter().enumerate() {
            let format = if index % 2 == 0 {
                body.clone().set_background_color(Color::RGB(0xF1F5F9))
            } else {
                body.clone()
            };
            strings(
                sheet,
                index as u32 + 1,
                &row(package, finding, now)
                    .into_iter()
                    .zip(HEADERS)
                    .filter(|(_, header)| findings_column(header))
                    .map(|(value, _)| value)
                    .collect::<Vec<_>>(),
                &format,
            )?;
            sheet.set_row_height(index as u32 + 1, 60)?;
        }
        sheet.set_freeze_panes(1, 0)?;
        if !report.findings.is_empty() {
            sheet.autofilter(0, 0, report.findings.len() as u32, headers.len() as u16 - 1)?;
        }
        Ok(())
    };
    build(&mut workbook).map_err(|_| "Could not build the spreadsheet.")?;
    workbook
        .save_to_buffer()
        .map_err(|_| "Could not finish the spreadsheet.".into())
}

/// Native validation and an existing atomic writer apply equally to every explicit export format.
#[tauri::command]
pub async fn security_assessment_export(
    window: tauri::WebviewWindow,
    path: String,
    payload: String,
    format: ExportFormat,
) -> Result<(), String> {
    super::super::runner::main_window(&window)?;
    tokio::task::spawn_blocking(move || {
        let now = current_time()?;
        let package = decode_package(payload.as_bytes(), now)?;
        let output = match format {
            ExportFormat::Json => encode_package(&package)?,
            ExportFormat::Csv => csv(&package, now),
            ExportFormat::Xlsx => xlsx(&package, now)?,
        };
        crate::atomic_io::atomic_replace_external(std::path::Path::new(&path), &output)
            .map_err(|_| "Could not write the selected export file.".into())
    })
    .await
    .map_err(|_| "The report export could not finish.")?
}

#[cfg(test)]
mod tests;
