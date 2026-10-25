//! Module scope, catalog integrity and output envelopes are security boundaries, not UI preferences.
use super::*;
use crate::security::{
    facts::{self, Fact},
    hardening,
    report::Request,
    sudo::Prompts,
};
use std::collections::{BTreeMap, BTreeSet};

/// Legacy callers select only the host, while empty, duplicate and arbitrary renderer IDs fail closed.
#[test]
fn module_selection_is_closed_canonical_and_compatible() {
    assert_eq!(selection(None).unwrap(), vec![ModuleId::Host]);
    assert!(selection(Some(&[])).is_err());
    assert!(selection(Some(&[ModuleId::Host, ModuleId::Host])).is_err());
    assert_eq!(
        selection(Some(&[ModuleId::Docker, ModuleId::Host])).unwrap(),
        vec![ModuleId::Host, ModuleId::Docker]
    );
    assert!(
        serde_json::from_str::<Request>(r#"{"kind":"hardening","modules":["$(whoami)"]}"#).is_err()
    );
    assert!(serde_json::from_str::<Request>(
        r#"{"kind":"hardening","modules":["vulnerabilities"]}"#
    )
    .is_err());
    let request: Request = serde_json::from_str(r#"{"kind":"hardening"}"#).unwrap();
    assert_eq!(
        selection(request.modules.as_deref()).unwrap(),
        vec![ModuleId::Host]
    );
}

/// Every native catalog count, ID and fact belongs to one bounded compiled collector module.
#[test]
fn module_catalog_and_protocol_are_complete_and_unique() {
    let mut ids = BTreeSet::new();
    let keys = keys(ORDER);
    assert_eq!(keys.len(), keys.iter().collect::<BTreeSet<_>>().len());
    for module in ORDER {
        let definition = module.definition();
        assert_eq!(definition.check_count, module.rules().len());
        assert!(!module.rules().is_empty());
        assert!(definition.label.len() <= 100 && definition.description.len() <= 500);
        let source = module.script();
        assert!(!source.contains('\r'));
        let declared: Vec<_> = source
            .lines()
            .filter_map(|line| line.strip_prefix("collect "))
            .filter_map(|line| line.split_whitespace().next())
            .collect();
        if module.is_runtime() {
            assert!(declared.is_empty());
        } else {
            assert_eq!(declared, module.keys());
        }
        for rule in module.rules() {
            assert!(ids.insert(rule.id));
            assert!(module.keys().contains(&rule.fact_key));
            for field in [
                rule.title,
                rule.target,
                rule.expected,
                rule.rationale,
                rule.scope,
                rule.guidance,
                rule.reference,
                rule.rule_version,
                rule.reviewed_at,
            ] {
                assert!(
                    !field.is_empty() && field.len() <= 1500,
                    "{} metadata",
                    rule.id
                );
            }
        }
    }
    assert_eq!(
        ids.len(),
        definitions()
            .iter()
            .map(|module| module.check_count)
            .sum::<usize>()
    );
}

/// Selecting an application must not execute the host, other applications, or an unapproved protected read.
#[test]
fn selected_scope_controls_script_protocol_and_passwords() {
    let selected = [ModuleId::Nginx];
    let script = script(&selected);
    assert!(!script.contains("collect aslr "));
    assert!(!script.contains("collect redis_"));
    assert!(!script.contains("collect docker_"));
    assert!(script.contains("collect nginx_"));
    let expected = keys(&selected);
    let mut prompts = Prompts::for_keys("nonce", &expected);
    assert!(prompts.feed(b"ZYNC-SUDO-nonce-shadow_empty:").is_err());
    let mut allowed = Prompts::for_keys("nonce", &expected);
    assert!(allowed.feed(b"ZYNC-SUDO-nonce-nginx_config:").unwrap());
    let mut payload = b"ZYNC_FACTS_V2\0nonce\0".to_vec();
    for key in &expected {
        payload.extend_from_slice(key.as_bytes());
        payload.extend_from_slice(b"\0\x000\0");
    }
    payload.extend_from_slice(b"complete\0");
    assert!(facts::decode(&payload, "nonce", &expected).is_ok());
    assert!(facts::decode(&payload, "nonce", &keys(&[ModuleId::Host])).is_err());
}

/// Partial evidence cannot enlarge the approved report scope or manufacture successful application checks.
#[test]
fn reports_retain_only_selected_modules_and_export_their_scope() {
    let facts = Facts(BTreeMap::from([
        (
            "os".into(),
            Fact {
                output: "ID=ubuntu\nVERSION_ID=24.04".into(),
                status: 0,
            },
        ),
        (
            "privilege".into(),
            Fact {
                output: "1000 user".into(),
                status: 0,
            },
        ),
    ]));
    let report = hardening::assess_selected(&facts, &[ModuleId::Redis]).unwrap();
    assert_eq!(report.modules.len(), 1);
    assert_eq!(report.modules[0].id, ModuleId::Redis);
    assert_eq!(report.findings.len(), ModuleId::Redis.rules().len());
    assert!(report
        .findings
        .iter()
        .all(|finding| finding.module_id == "redis" && finding.status == "notAssessed"));
    let export = serde_json::to_value(report).unwrap();
    assert_eq!(export["modules"][0]["id"], "redis");
    assert_eq!(export["findings"][0]["moduleId"], "redis");
}

/// Host, system and application metadata share strict decoding while retaining distinct policy.
#[test]
fn shared_metadata_requires_exact_type_and_unsigned_fields() {
    use crate::security::facts::file_metadata;
    assert_eq!(file_metadata("81a4 0 42", 0o100000), Some((0x81a4, 0, 42)));
    assert_eq!(
        file_metadata("c1b0 0 998", 0o140000),
        Some((0xc1b0, 0, 998))
    );
    assert_eq!(file_metadata("41ed 0 0", 0o040000), Some((0x41ed, 0, 0)));
    for value in [
        "81a4 +0 0",
        "+81a4 0 0",
        "10000 0 0",
        "81a4 0 0 extra",
        "81a4 -1 0",
        "81a4 4294967296 0",
        "41ed 0 0",
    ] {
        assert!(file_metadata(value, 0o100000).is_none(), "{value}");
    }
    let facts = Facts(BTreeMap::from([
        (
            "privilege".into(),
            Fact {
                output: "1000 user".into(),
                status: 0,
            },
        ),
        (
            "nginx_config".into(),
            Fact {
                output: String::new(),
                status: 66,
            },
        ),
    ]));
    assert!(!facts.can_retry_with_sudo("nginx_config"));
    assert!(!facts.needs_elevated_access("nginx_config"));
}
