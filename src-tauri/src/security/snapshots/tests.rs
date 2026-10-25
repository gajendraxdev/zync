//! Imported JSON is untrusted comparison data, never a new assessment or an authenticity assertion.
use super::*;
use serde_json::{json, Value};

/// Build a public synthetic report with exact identity and evidence keys; no real host or credential is read.
pub(super) fn sample() -> Value {
    let key = format!("sha256:{}", "a".repeat(64));
    json!({"version":2,"subject":{"connectionId":"fixture","name":"Fixture","host":"fixture.invalid","username":"fixture","port":22},
        "startedAt":1,"completedAt":2,"report":{"kind":"hardening","version":"zync-linux-7","target":"Connected Linux host","os":"ubuntu 24.04",
        "totalFindings":1,"truncated":false,"notes":[],"policy":{"id":"general","label":"General host","revision":"zync-role-1"},
        "transportFingerprint":format!("SHA256:{}",base64::engine::general_purpose::STANDARD_NO_PAD.encode([0u8;32])),
        "modules":[{"id":"host","label":"Host baseline","description":"Host","group":"host","checkCount":38,"recommended":true}],
        "findings":[{"id":"LINUX-aslr","moduleId":"host","targetKey":key,"evidenceKey":key,"evidenceKind":"runtime","priority":"medium",
            "status":"attention","title":"Memory layout","target":"kernel.randomize_va_space","evidence":"0","recommendation":"Review compatibility",
            "reference":"https://docs.kernel.org/admin-guide/sysctl/","category":"Kernel","observed":"Disabled","expected":"Enabled",
            "rationale":"Limit exploitation","scope":"Current value","ruleVersion":"1","reviewedAt":"2026-10-25",
            "needsElevatedAccess":false,"sudoRetryEligible":false}]}})
}

/// Drop unknown instructions, secrets and configuration instead of carrying them into the pane or later exports.
#[test]
fn report_import_is_bounded_inert_and_drops_unknown_fields() {
    let mut value = sample();
    value["instructions"] = "execute an arbitrary command".into();
    value["report"]["credentials"] = json!({"secret":"private-fixture-secret"});
    value["report"]["modules"][0]["auth"] = json!({"secret":"private-fixture-secret"});
    let parsed = decode_report(&serde_json::to_vec(&value).unwrap()).unwrap();
    let output = serde_json::to_string(&parsed).unwrap();
    assert!(!output.contains("instructions") && !output.contains("private-fixture-secret"));
    assert_eq!(parsed.subject.host, "fixture.invalid");
    assert_eq!(parsed.report.findings[0].status, "attention");
    assert!(decode_report(&vec![b' '; MAX_REPORT_BYTES + 1]).is_err());
    assert!(decode_report(b"not JSON").is_err());
}

/// Optional guidance remains plain, bounded data and does not alter historical evidence identities.
#[test]
fn remediation_import_normalizes_text_and_preserves_legacy_reports() {
    let legacy = decode_report(&serde_json::to_vec(&sample()).unwrap()).unwrap();
    assert!(legacy.report.findings[0].remediation.is_none());
    assert!(!serde_json::to_string(&legacy)
        .unwrap()
        .contains("remediation"));

    let mut value = sample();
    value["report"]["findings"][0]["remediation"] = json!({
        "change":"Review\nsetting\u{202e}\u{001b}",
        "impact":"May affect compatibility", "verification":"Check the observed value",
        "rollback":"Restore the previous setting", "command":"discard-this-unknown-field"
    });
    let parsed = decode_report(&serde_json::to_vec(&value).unwrap()).unwrap();
    let finding = &parsed.report.findings[0];
    let guide = finding.remediation.as_ref().unwrap();
    assert_eq!(guide.change, "Review\nsetting");
    assert_eq!(finding.status, legacy.report.findings[0].status);
    assert_eq!(finding.target_key, legacy.report.findings[0].target_key);
    assert_eq!(finding.evidence_key, legacy.report.findings[0].evidence_key);
    assert!(!serde_json::to_string(&parsed)
        .unwrap()
        .contains("discard-this-unknown-field"));
}

/// Step boundaries survive normalized save/export roundtrips without carrying terminal or bidi controls.
#[test]
fn remediation_steps_preserve_line_breaks_and_normalize_controls() {
    let mut value = sample();
    value["report"]["findings"][0]["remediation"] = json!({
        "change":"Record first\r\nReview second\rChange third\u{202e}\u{001b}",
        "impact":"Review\ncompatibility", "verification":"Check first\r\nTest\tsecond\rConfirm third",
        "rollback":"Restore\r\nprevious setting"
    });
    let parsed = decode_report(&serde_json::to_vec(&value).unwrap()).unwrap();
    let guide = parsed.report.findings[0].remediation.as_ref().unwrap();
    assert_eq!(guide.change, "Record first\nReview second\nChange third");
    assert_eq!(
        guide.verification,
        "Check first\nTest second\nConfirm third"
    );
    assert_eq!(guide.impact, "Review compatibility");
    assert_eq!(guide.rollback, "Restore  previous setting");
    let before = guide.clone();
    let package = ReportPackage {
        result: parsed,
        annotations: vec![],
    };
    let decoded = decode_package(&encode_package(&package).unwrap(), 10000).unwrap();
    assert_eq!(
        decoded.result.report.findings[0].remediation.as_ref(),
        Some(&before)
    );
    value["report"]["findings"][0]["remediation"]["change"] =
        "x\n".repeat(MAX_REMEDIATION_FIELD_CHARS / 2 + 1).into();
    assert!(decode_report(&serde_json::to_vec(&value).unwrap()).is_err());
}

/// Optional summaries stay recorded data and never replace the full scope or legacy provenance.
#[test]
fn concise_scope_import_preserves_legacy_context_and_identity() {
    let legacy = decode_report(&serde_json::to_vec(&sample()).unwrap()).unwrap();
    assert!(legacy.report.findings[0].scope_summary.is_none());
    assert!(!serde_json::to_string(&legacy)
        .unwrap()
        .contains("scopeSummary"));
    let mut value = sample();
    value["report"]["findings"][0]["scopeSummary"] = "Current\nsetting only\u{202e}\u{001b}".into();
    let parsed = decode_report(&serde_json::to_vec(&value).unwrap()).unwrap();
    let finding = &parsed.report.findings[0];
    assert_eq!(
        finding.scope_summary.as_deref(),
        Some("Current setting only")
    );
    let original = &legacy.report.findings[0];
    assert_eq!(finding.scope, original.scope);
    assert_eq!(finding.rationale, original.rationale);
    assert_eq!(finding.target_key, original.target_key);
    assert_eq!(finding.evidence_key, original.evidence_key);
    assert_eq!(finding.status, original.status);
}

/// Present summaries are useful bounded strings, including supplementary and multi-byte text.
#[test]
fn concise_scope_import_rejects_empty_and_oversized_summaries() {
    for summary in [
        String::new(),
        " \u{202e}\u{001b} ".into(),
        "é".repeat(MAX_SCOPE_SUMMARY_CHARS + 1),
    ] {
        let mut value = sample();
        value["report"]["findings"][0]["scopeSummary"] = summary.into();
        assert!(decode_report(&serde_json::to_vec(&value).unwrap()).is_err());
    }
    let mut value = sample();
    value["report"]["findings"][0]["scopeSummary"] = "🌍".repeat(MAX_SCOPE_SUMMARY_CHARS).into();
    assert!(decode_report(&serde_json::to_vec(&value).unwrap()).is_ok());
}

/// Every present guide needs all four useful sections; size limits apply to Unicode characters.
#[test]
fn remediation_import_rejects_incomplete_empty_and_oversized_sections() {
    let guide =
        json!({"change":"Change", "impact":"Impact", "verification":"Verify", "rollback":"Undo"});
    for field in ["change", "impact", "verification", "rollback"] {
        for replacement in [
            "".into(),
            " \u{001b}\u{202e} ".into(),
            "é".repeat(MAX_REMEDIATION_FIELD_CHARS + 1),
        ] {
            let mut value = sample();
            value["report"]["findings"][0]["remediation"] = guide.clone();
            value["report"]["findings"][0]["remediation"][field] = replacement.into();
            assert!(
                decode_report(&serde_json::to_vec(&value).unwrap()).is_err(),
                "{field}"
            );
        }
        let mut value = sample();
        value["report"]["findings"][0]["remediation"] = guide.clone();
        value["report"]["findings"][0]["remediation"]
            .as_object_mut()
            .unwrap()
            .remove(field);
        assert!(
            decode_report(&serde_json::to_vec(&value).unwrap()).is_err(),
            "missing {field}"
        );
    }
    let mut value = sample();
    value["report"]["findings"][0]["remediation"] = guide;
    value["report"]["findings"][0]["remediation"]["change"] =
        "é".repeat(MAX_REMEDIATION_FIELD_CHARS).into();
    assert!(decode_report(&serde_json::to_vec(&value).unwrap()).is_ok());
}

/// An imported collection gap, contextual observation or passing result cannot suggest a config change.
#[test]
fn remediation_import_drops_guides_for_non_attention_results() {
    for status in ["notAssessed", "notApplicable", "informational", "passed"] {
        let mut value = sample();
        value["report"]["findings"][0]["status"] = status.into();
        value["report"]["findings"][0]["remediation"] = json!({
            "change":"Do not carry this change", "impact":"Impact", "verification":"Verify", "rollback":"Undo"
        });
        let parsed = decode_report(&serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(parsed.report.findings[0].status, status);
        assert!(parsed.report.findings[0].remediation.is_none(), "{status}");
        assert!(!serde_json::to_string(&parsed)
            .unwrap()
            .contains("Do not carry this change"));
    }
}

/// A hostname with controls cannot silently normalize into a trusted comparison subject.
#[test]
fn report_import_rejects_ambiguous_identities_states_and_counts() {
    for host in [
        "fix\u{202e}ture.invalid",
        "fixture.invalid\n",
        "fixture\0.invalid",
    ] {
        let mut value = sample();
        value["subject"]["host"] = host.into();
        assert!(decode_report(&serde_json::to_vec(&value).unwrap()).is_err());
    }
    for (field, replacement) in [
        ("status", "secure"),
        ("id", "__proto__"),
        ("targetKey", "not-a-digest"),
        ("evidenceKey", "sha256:short"),
    ] {
        let mut value = sample();
        value["report"]["findings"][0][field] = replacement.into();
        assert!(
            decode_report(&serde_json::to_vec(&value).unwrap()).is_err(),
            "{field}"
        );
    }
    let mut duplicate = sample();
    let finding = duplicate["report"]["findings"][0].clone();
    duplicate["report"]["findings"]
        .as_array_mut()
        .unwrap()
        .push(finding);
    assert!(decode_report(&serde_json::to_vec(&duplicate).unwrap()).is_err());
    let mut future = sample();
    future["startedAt"] = 3.into();
    assert!(decode_report(&serde_json::to_vec(&future).unwrap()).is_err());
    let mut wrong = sample();
    wrong["report"]["kind"] = "vulnerabilities".into();
    assert!(decode_report(&serde_json::to_vec(&wrong).unwrap()).is_err());
}

/// Legacy snapshots can be inspected without inventing absent policy or cryptographic host identity.
#[test]
fn legacy_reports_keep_missing_comparison_provenance_absent() {
    let mut value = sample();
    let report = value["report"].as_object_mut().unwrap();
    report.remove("transportFingerprint");
    report.remove("policy");
    for key in [
        "targetKey",
        "evidenceKey",
        "evidenceKind",
        "priority",
        "moduleId",
        "ruleVersion",
    ] {
        report["findings"][0].as_object_mut().unwrap().remove(key);
    }
    let parsed = decode_report(&serde_json::to_vec(&value).unwrap()).unwrap();
    assert!(parsed.report.transport_fingerprint.is_none() && parsed.report.policy.is_none());
    assert!(
        parsed.report.findings[0].target_key.is_empty()
            && parsed.report.findings[0].evidence_kind.is_none()
    );
}

/// Acceptance files require bounded reasons, exact identities and an expiring versioned decision.
#[test]
fn annotations_preserve_original_status_and_enforce_identity_expiry() {
    let key = format!("sha256:{}", "b".repeat(64));
    let annotation = json!({"id":uuid::Uuid::new_v4().to_string(),"host":"fixture.invalid","username":"fixture","port":22,
        "transportFingerprint":format!("SHA256:{}",base64::engine::general_purpose::STANDARD_NO_PAD.encode([0u8;32])),
        "policyId":"general","policyRevision":"zync-role-1","moduleId":"host","targetKey":key,"ruleId":"LINUX-aslr","ruleVersion":"1","evidenceKey":key,
        "reason":"Compatibility review","createdAt":1000,"expiresAt":5000});
    let value = json!({"version":1,"annotations":[annotation]});
    assert_eq!(
        decode_annotations(&serde_json::to_vec(&value).unwrap(), 2000)
            .unwrap()
            .len(),
        1
    );
    for field in ["reason", "ruleId", "transportFingerprint", "evidenceKey"] {
        let mut bad = value.clone();
        bad["annotations"][0][field] = "".into();
        assert!(
            decode_annotations(&serde_json::to_vec(&bad).unwrap(), 2000).is_err(),
            "{field}"
        );
    }
    for expiry in [1000, 1000 + MAX_ACCEPTANCE_MS + 1] {
        let mut bad = value.clone();
        bad["annotations"][0]["expiresAt"] = expiry.into();
        assert!(decode_annotations(&serde_json::to_vec(&bad).unwrap(), 2000).is_err());
    }
    for reason in ["\u{001b}", "\u{202e}", " \u{001b}\u{202e} "] {
        let mut bad = value.clone();
        bad["annotations"][0]["reason"] = reason.into();
        assert!(decode_annotations(&serde_json::to_vec(&bad).unwrap(), 2000).is_err());
    }
    let mut duplicate = value.clone();
    duplicate["annotations"]
        .as_array_mut()
        .unwrap()
        .push(value["annotations"][0].clone());
    assert!(decode_annotations(&serde_json::to_vec(&duplicate).unwrap(), 2000).is_err());
    assert!(decode_annotations(&vec![b' '; MAX_ANNOTATION_BYTES + 1], 2000).is_err());
}

/// The local reader caps streaming bytes and rejects directories before any JSON is interpreted.
#[tokio::test]
async fn local_import_reader_requires_regular_bounded_files() {
    let folder = tempfile::tempdir().unwrap();
    let file = folder.path().join("snapshot.json");
    std::fs::write(&file, b"{\"version\":2}").unwrap();
    assert_eq!(
        read_bounded(file.to_str().unwrap(), 64).await.unwrap(),
        b"{\"version\":2}"
    );
    assert!(read_bounded(folder.path().to_str().unwrap(), 64)
        .await
        .is_err());
    assert!(read_bounded(file.to_str().unwrap(), 4).await.is_err());
}
